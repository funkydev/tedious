# Tedious (node implementation of TDS)
[![Dependency Status](https://david-dm.org/tediousjs/tedious.svg)](https://david-dm.org/tediousjs/tedious) [![NPM version](https://badge.fury.io/js/tedious.svg)](http://badge.fury.io/js/tedious) [![Build Status](https://secure.travis-ci.org/tediousjs/tedious.svg)](http://travis-ci.org/tediousjs/tedious) [![Build Status](https://ci.appveyor.com/api/projects/status/ike3p58hljpyffrl?svg=true)](https://ci.appveyor.com/project/tediousjs/tedious) [![Slack Status](https://tediousjs-slack.herokuapp.com/badge.svg)](https://tediousjs-slack.herokuapp.com/)[![Code Coverage](https://codecov.io/gh/tediousjs/tedious/badge.svg)](https://codecov.io/gh/tediousjs/tedious)


Tedious is a pure-Javascript implementation of the [TDS protocol](http://msdn.microsoft.com/en-us/library/dd304523.aspx),
which is used to interact with instances of Microsoft's SQL Server. It is intended to be a fairly slim implementation of the protocol, with not too much additional functionality.

**NOTE: New columns are nullable by default as of version 1.11.0**

Previous behavior can be restored using `config.options.enableAnsiNullDefault = false`. See [pull request 230](https://github.com/tediousjs/tedious/pull/230).

**NOTE: Default login behavior has changed slightly as of version 1.2**

See the [changelog](https://github.com/tediousjs/tedious/releases) for version history.


### Supported TDS versions

- TDS 7.4 (SQL Server 2012/2014/2016/2017)
- TDS 7.3.B (SQL Server 2008 R2)
- TDS 7.3.A (SQL Server 2008)
- TDS 7.2 (SQL Server 2005)
- TDS 7.1 (SQL Server 2000)

## Installation

Node.js is a prerequisite for installing tedious. Once you have installed [Node.js](https://nodejs.org/), installing tedious is simple:

    npm install tedious

## Getting Started
- [Node.js + macOS](https://www.microsoft.com/en-us/sql-server/developer-get-started/node/mac/)
- [Node.js + Red Hat Enterprise Linux](https://www.microsoft.com/en-us/sql-server/developer-get-started/node/rhel/)
- [Node.js + SUSE Linux Enterprise Server](https://www.microsoft.com/en-us/sql-server/developer-get-started/node/sles/)
- [Node.js + Ubuntu](https://www.microsoft.com/en-us/sql-server/developer-get-started/node/ubuntu/)
- [Node.js + Windows](https://www.microsoft.com/en-us/sql-server/developer-get-started/node/windows/)

### Connecting to a database
```js
  const Connection = require('tedious').Connection;

  const config = {
    server: "192.168.1.210", // or "localhost"
    options: {},
    authentication: {
      type: "default",
      options: {
        userName: "test",
        password: "test",
      }
    }
  };

  const connection = new Connection(config);

  // Setup event handler when the connection is established.
  connection.on('connect', function(err) {
    if(err) {
      console.log('Error: ', err)
    }
    // If no error, then good to go...
    executeStatement();
  });

  // Initialize the connection.
  connection.connect();
```
### Setting up a SQL Server in Docker
Checkout the official [docker images](https://hub.docker.com/_/microsoft-mssql-server)

**In Powershell**: </br>
- **Pull** the docker image: </br>
`docker pull mcr.microsoft.com/mssql/server:2019-latest`

- **Start** the SQL Server: </br>
`docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=password_01" -p 1433:1433 -v sqldatavol:/var/opt/mssql -d`
    - Note: Data should be preserved in `sqldatavol` in the event the container is stopped or removed. To check, run `Docker volume ls` or [visit here](https://www.darrinbishop.com/blog/2021/02/step-by-step-win10-and-sql-server-with-docker-volumes/) for more information about data persistence.
- In your javascript file running `tedious`, **set the config** to something like:
```js
var config = {
  "server": "0.0.0.0",
  "authentication": {
    "type": "default",
    "options": {
      "userName": "sa",
      "password": "password_01"
    }
  },
  "options": {
    "port": 1433,
    "database": "master",
    "trustServerCertificate": true
  }
}
```
- **Verify** that the server has been setup and `tedious` is able to connect by running the query:
```js
// file.js
const Connection = require('tedious').Connection;

const connection = new Connection(config);

connection.on('connect', (err) => {
  if (err) {
    console.log('Connection Failed');
    throw err;
  }

  executeStatement();
});

connection.connect();

function executeStatement() {
  const request = new Request("select 42, 'hello world'", (err, rowCount) => {
    if (err) {
      throw err;
    }
    console.log('DONE!');
    connection.close();
  });

  // Emits a 'DoneInProc' event when completed.
  request.on('row', (columns) => {
    columns.forEach((column) => {
      if (column.value === null) {
        console.log('NULL');
      } else {
        console.log(column.value);
      }
    });
  });

  // In SQL Server 2000 you may need: connection.execSqlBatch(request);
  connection.execSql(request);
}
```
- **Expected** output: </br>
```
42
hello world
1 rows returned
DONE!
```

- For more information, visit the official documentation page below!
<a name="documentation"></a>
## Documentation
More documentation and code samples are available at [tediousjs.github.io/tedious/](http://tediousjs.github.io/tedious/)

<a name="name"></a>
## Name
_Tedious_ is simply derived from a fast, slightly garbled, pronunciation of the letters T, D and S.

## Developer Survey

We'd like to learn more about how you use tedious:

<a href="https://aka.ms/mssqltedioussurvey"><img style="float: right;"  height="67" width="156" src="https://sqlchoice.blob.core.windows.net/sqlchoice/static/images/survey.png"></a>

<a name="contributing"></a>
## Contributing
We welcome contributions from the community. Feel free to checkout the code and submit pull requests.

<a name="license"></a>
## License

Copyright (c) 2010-2021 Mike D Pilsbury

The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
