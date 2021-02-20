import Debug from '../debug';
import { InternalConnectionOptions } from '../connection';
import JSBI from 'jsbi';

import { TYPE, Token, ColMetadataToken, DoneToken, DoneInProcToken, DoneProcToken, DatabaseEnvChangeToken, LanguageEnvChangeToken, CharsetEnvChangeToken, PacketSizeEnvChangeToken, BeginTransactionEnvChangeToken, CommitTransactionEnvChangeToken, RollbackTransactionEnvChangeToken, RoutingEnvChangeToken, DatabaseMirroringPartnerEnvChangeToken, ResetConnectionEnvChangeToken, CollationChangeToken, ErrorMessageToken, FedAuthInfoToken, FeatureExtAckToken, InfoMessageToken, LoginAckToken, OrderToken, ReturnStatusToken, ReturnValueToken, RowToken, NBCRowToken, SSPIToken } from './token';

import colMetadataParser, { ColumnMetadata } from './colmetadata-token-parser';
import { doneParser, doneInProcParser, doneProcParser } from './done-token-parser';
import envChangeParser from './env-change-token-parser';
import { errorParser, infoParser } from './infoerror-token-parser';
import fedAuthInfoParser from './fedauth-info-parser';
import featureExtAckParser from './feature-ext-ack-parser';
import loginAckParser from './loginack-token-parser';
import orderParser from './order-token-parser';
import returnStatusParser from './returnstatus-token-parser';
import returnValueParser from './returnvalue-token-parser';
import rowParser from './row-token-parser';
import nbcRowParser from './nbcrow-token-parser';
import sspiParser from './sspi-token-parser';

const tokenParsers = {
  [TYPE.COLMETADATA]: colMetadataParser,
  [TYPE.DONE]: doneParser,
  [TYPE.DONEINPROC]: doneInProcParser,
  [TYPE.DONEPROC]: doneProcParser,
  [TYPE.ENVCHANGE]: envChangeParser,
  [TYPE.ERROR]: errorParser,
  [TYPE.FEDAUTHINFO]: fedAuthInfoParser,
  [TYPE.FEATUREEXTACK]: featureExtAckParser,
  [TYPE.INFO]: infoParser,
  [TYPE.LOGINACK]: loginAckParser,
  [TYPE.ORDER]: orderParser,
  [TYPE.RETURNSTATUS]: returnStatusParser,
  [TYPE.RETURNVALUE]: returnValueParser,
  [TYPE.ROW]: rowParser,
  [TYPE.NBCROW]: nbcRowParser,
  [TYPE.SSPI]: sspiParser
};

type AnyToken = DoneToken | DoneInProcToken | DoneProcToken | ColMetadataToken | DatabaseEnvChangeToken | LanguageEnvChangeToken | CharsetEnvChangeToken | PacketSizeEnvChangeToken | BeginTransactionEnvChangeToken | CommitTransactionEnvChangeToken | RollbackTransactionEnvChangeToken | RoutingEnvChangeToken | DatabaseMirroringPartnerEnvChangeToken | ResetConnectionEnvChangeToken | CollationChangeToken | ErrorMessageToken | FedAuthInfoToken | FeatureExtAckToken | InfoMessageToken | LoginAckToken | OrderToken | ReturnStatusToken | ReturnValueToken | RowToken | NBCRowToken | SSPIToken;

class NotEnoughDataError extends Error {
  constructor() {
    super('not enough data');
  }
}

class StreamingBuffer {
  iterator: AsyncIterator<Buffer, any, undefined> | Iterator<Buffer, any, undefined>;
  data: Buffer;
  position: number;

  constructor(iterable: AsyncIterable<Buffer> | Iterable<Buffer>) {
    this.iterator = ((iterable as AsyncIterable<Buffer>)[Symbol.asyncIterator] ?? (iterable as Iterable<Buffer>)[Symbol.iterator]).call(iterable);
    this.data = Buffer.alloc(0);
    this.position = 0;
  }

  async awaitChunk() {
    const result = await this.iterator.next();

    if (result.done) {
      throw new NotEnoughDataError();
    }

    if (this.position) {
      this.data = Buffer.concat([this.data.slice(this.position), result.value]);
    } else {
      this.data = Buffer.concat([this.data, result.value]);
    }
    this.position = 0;
  }

  async awaitData(length: number) {
    while (this.data.length < this.position + length) {
      const result = await this.iterator.next();

      if (result.done) {
        throw new NotEnoughDataError();
      }

      if (this.position) {
        this.data = Buffer.concat([this.data.slice(this.position), result.value]);
      } else {
        this.data = Buffer.concat([this.data, result.value]);
      }
      this.position = 0;
    }
  }

  availableBytes(): number {
    return this.data.length - this.position;
  }

  assertEnoughBytes(length: number) {
    if (this.availableBytes() < length) {
      throw new NotEnoughDataError();
    }
  }

  readUInt8() {
    this.assertEnoughBytes(1);

    const value = this.data.readUInt8(this.position);
    this.position += 1;
    return value;
  }

  readUInt16LE() {
    this.assertEnoughBytes(2);

    const value = this.data.readUInt16LE(this.position);
    this.position += 2;
    return value;
  }

  readUInt32LE() {
    this.assertEnoughBytes(4);

    const value = this.data.readUInt32LE(this.position);
    this.position += 4;
    return value;
  }

  readBigUInt64LE(): JSBI {
    this.assertEnoughBytes(8);

    const low = JSBI.BigInt(this.data.readUInt32LE(this.position));
    const high = JSBI.BigInt(this.data.readUInt32LE(this.position + 4));

    this.position += 8;

    return JSBI.add(low, JSBI.leftShift(high, JSBI.BigInt(32)));
  }
}

class Parser {
  debug: Debug;
  colMetadata: ColumnMetadata[];
  options: InternalConnectionOptions;

  buffer: Buffer;
  position: number;
  suspended: boolean;
  next?: () => void;

  static async * parseTokens(iterable: AsyncIterable<Buffer> | Iterable<Buffer>, debug: Debug, options: InternalConnectionOptions) {
    const sb = new StreamingBuffer(iterable);

    const parser = new Parser(debug, options);

    while (true) {
      if (sb.availableBytes() < 1) {
        try {
          await sb.awaitData(1);
        } catch (err) {
          if (err instanceof NotEnoughDataError) {
            return;
          }

          throw err;
        }
      }

      const type = sb.readUInt8();

      if (tokenParsers[type]) {
        parser.position = sb.position;
        parser.buffer = sb.data;

        let token: AnyToken | undefined;
        let finished = false;

        tokenParsers[type](parser, parser.options, (t: undefined | AnyToken) => {
          finished = true;
          token = t;
        });

        // Did we finish parsing? If not, we need to wait for more data and resume parsing
        while (!finished) {
          sb.position = parser.position;

          await sb.awaitChunk();

          // Update our position and continue parsing until we're done
          parser.position = sb.position;
          parser.buffer = sb.data;

          parser.suspended = false;
          const next = parser.next!;
          next();
        }

        // We're done with parsing. Check if there was a token and yield it back
        if (token) {
          if (token instanceof ColMetadataToken) {
            parser.colMetadata = token.columns;
          }

          yield token;
        }

        sb.position = parser.position;
      } else {
        throw new Error('Unknown type: ' + type);
      }
    }
  }

  constructor(debug: Debug, options: InternalConnectionOptions) {
    this.debug = debug;
    this.colMetadata = [];
    this.options = options;

    this.buffer = Buffer.alloc(0);
    this.position = 0;
    this.suspended = false;
    this.next = undefined;
  }

  suspend(next: () => void) {
    this.suspended = true;
    this.next = next;
  }

  awaitData(length: number, callback: () => void) {
    if (this.position + length <= this.buffer.length) {
      callback();
    } else {
      this.suspend(() => {
        this.awaitData(length, callback);
      });
    }
  }

  readInt8(callback: (data: number) => void) {
    this.awaitData(1, () => {
      const data = this.buffer.readInt8(this.position);
      this.position += 1;
      callback(data);
    });
  }

  readUInt8(callback: (data: number) => void) {
    this.awaitData(1, () => {
      const data = this.buffer.readUInt8(this.position);
      this.position += 1;
      callback(data);
    });
  }

  readInt16LE(callback: (data: number) => void) {
    this.awaitData(2, () => {
      const data = this.buffer.readInt16LE(this.position);
      this.position += 2;
      callback(data);
    });
  }

  readInt16BE(callback: (data: number) => void) {
    this.awaitData(2, () => {
      const data = this.buffer.readInt16BE(this.position);
      this.position += 2;
      callback(data);
    });
  }

  readUInt16LE(callback: (data: number) => void) {
    this.awaitData(2, () => {
      const data = this.buffer.readUInt16LE(this.position);
      this.position += 2;
      callback(data);
    });
  }

  readUInt16BE(callback: (data: number) => void) {
    this.awaitData(2, () => {
      const data = this.buffer.readUInt16BE(this.position);
      this.position += 2;
      callback(data);
    });
  }

  readInt32LE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readInt32LE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readInt32BE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readInt32BE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readUInt32LE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readUInt32LE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readUInt32BE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readUInt32BE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readBigInt64LE(callback: (data: JSBI) => void) {
    this.awaitData(8, () => {
      const result = JSBI.add(
        JSBI.leftShift(
          JSBI.BigInt(
            this.buffer[this.position + 4] +
            this.buffer[this.position + 5] * 2 ** 8 +
            this.buffer[this.position + 6] * 2 ** 16 +
            (this.buffer[this.position + 7] << 24) // Overflow
          ),
          JSBI.BigInt(32)
        ),
        JSBI.BigInt(
          this.buffer[this.position] +
          this.buffer[this.position + 1] * 2 ** 8 +
          this.buffer[this.position + 2] * 2 ** 16 +
          this.buffer[this.position + 3] * 2 ** 24
        )
      );

      this.position += 8;

      callback(result);
    });
  }

  readInt64LE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = Math.pow(2, 32) * this.buffer.readInt32LE(this.position + 4) + ((this.buffer[this.position + 4] & 0x80) === 0x80 ? 1 : -1) * this.buffer.readUInt32LE(this.position);
      this.position += 8;
      callback(data);
    });
  }

  readInt64BE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = Math.pow(2, 32) * this.buffer.readInt32BE(this.position) + ((this.buffer[this.position] & 0x80) === 0x80 ? 1 : -1) * this.buffer.readUInt32BE(this.position + 4);
      this.position += 8;
      callback(data);
    });
  }

  readBigUInt64LE(callback: (data: JSBI) => void) {
    this.awaitData(8, () => {
      const low = JSBI.BigInt(this.buffer.readUInt32LE(this.position));
      const high = JSBI.BigInt(this.buffer.readUInt32LE(this.position + 4));

      this.position += 8;

      callback(JSBI.add(low, JSBI.leftShift(high, JSBI.BigInt(32))));
    });
  }

  readUInt64LE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = Math.pow(2, 32) * this.buffer.readUInt32LE(this.position + 4) + this.buffer.readUInt32LE(this.position);
      this.position += 8;
      callback(data);
    });
  }

  readUInt64BE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = Math.pow(2, 32) * this.buffer.readUInt32BE(this.position) + this.buffer.readUInt32BE(this.position + 4);
      this.position += 8;
      callback(data);
    });
  }

  readFloatLE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readFloatLE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readFloatBE(callback: (data: number) => void) {
    this.awaitData(4, () => {
      const data = this.buffer.readFloatBE(this.position);
      this.position += 4;
      callback(data);
    });
  }

  readDoubleLE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = this.buffer.readDoubleLE(this.position);
      this.position += 8;
      callback(data);
    });
  }

  readDoubleBE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const data = this.buffer.readDoubleBE(this.position);
      this.position += 8;
      callback(data);
    });
  }

  readUInt24LE(callback: (data: number) => void) {
    this.awaitData(3, () => {
      const low = this.buffer.readUInt16LE(this.position);
      const high = this.buffer.readUInt8(this.position + 2);

      this.position += 3;

      callback(low | (high << 16));
    });
  }

  readUInt40LE(callback: (data: number) => void) {
    this.awaitData(5, () => {
      const low = this.buffer.readUInt32LE(this.position);
      const high = this.buffer.readUInt8(this.position + 4);

      this.position += 5;

      callback((0x100000000 * high) + low);
    });
  }

  readUNumeric64LE(callback: (data: number) => void) {
    this.awaitData(8, () => {
      const low = this.buffer.readUInt32LE(this.position);
      const high = this.buffer.readUInt32LE(this.position + 4);

      this.position += 8;

      callback((0x100000000 * high) + low);
    });
  }

  readUNumeric96LE(callback: (data: number) => void) {
    this.awaitData(12, () => {
      const dword1 = this.buffer.readUInt32LE(this.position);
      const dword2 = this.buffer.readUInt32LE(this.position + 4);
      const dword3 = this.buffer.readUInt32LE(this.position + 8);

      this.position += 12;

      callback(dword1 + (0x100000000 * dword2) + (0x100000000 * 0x100000000 * dword3));
    });
  }

  readUNumeric128LE(callback: (data: number) => void) {
    this.awaitData(16, () => {
      const dword1 = this.buffer.readUInt32LE(this.position);
      const dword2 = this.buffer.readUInt32LE(this.position + 4);
      const dword3 = this.buffer.readUInt32LE(this.position + 8);
      const dword4 = this.buffer.readUInt32LE(this.position + 12);

      this.position += 16;

      callback(dword1 + (0x100000000 * dword2) + (0x100000000 * 0x100000000 * dword3) + (0x100000000 * 0x100000000 * 0x100000000 * dword4));
    });
  }

  // Variable length data

  readBuffer(length: number, callback: (data: Buffer) => void) {
    this.awaitData(length, () => {
      const data = this.buffer.slice(this.position, this.position + length);
      this.position += length;
      callback(data);
    });
  }

  // Read a Unicode String (BVARCHAR)
  readBVarChar(callback: (data: string) => void) {
    this.readUInt8((length) => {
      this.readBuffer(length * 2, (data) => {
        callback(data.toString('ucs2'));
      });
    });
  }

  // Read a Unicode String (USVARCHAR)
  readUsVarChar(callback: (data: string) => void) {
    this.readUInt16LE((length) => {
      this.readBuffer(length * 2, (data) => {
        callback(data.toString('ucs2'));
      });
    });
  }

  // Read binary data (BVARBYTE)
  readBVarByte(callback: (data: Buffer) => void) {
    this.readUInt8((length) => {
      this.readBuffer(length, callback);
    });
  }

  // Read binary data (USVARBYTE)
  readUsVarByte(callback: (data: Buffer) => void) {
    this.readUInt16LE((length) => {
      this.readBuffer(length, callback);
    });
  }
}

export default Parser;
module.exports = Parser;
