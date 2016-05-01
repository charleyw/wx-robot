'use strict';
const Log = require('log');
const log = new Log('info');

class SilentResponder {
  onText(message, reply, ctx) {
    log.info(this.constructor.name, ': ', ctx.fromUserName, message)
  }
}

module.exports = SilentResponder;

//new TuLinRobot().onText('你好', console.log, {fromUserName: '@123456'})