'use strict';
const request = require('request');

class TuLinRobot {
  onText(message, reply, ctx) {
    this.queryTuLinApi(message, ctx.fromUserName.replace(/@*/, ''))
      .then(resp => {
        reply(resp.text)
      }, console.err)
  }

  queryTuLinApi(text, contextId) {
    return new Promise((resolve, reject) => {
      request({
        uri: 'http://www.tuling123.com/openapi/api',
        qs: {
          key: 'e2617ba9eb3b6bacf2dce5086bf17874',
          info: text,
          userid: contextId
        }
      }, (err, resp, body) => {
        if (!err) {
          resolve(JSON.parse(body));
        } else {
          reject(err);
        }
      })
    })
  }
}

module.exports = TuLinRobot;

//new TuLinRobot().onText('你好', console.log, {fromUserName: '@123456'})