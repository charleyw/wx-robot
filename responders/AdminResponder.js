'use strict';
const SilentResponder = require('./SilentResponder');
const TuLinRobotResponder = require('./TuLinRobot');
const responders = [new SilentResponder(), new TuLinRobotResponder()];

class AdminResponder {
  constructor(wxClient) {
    this.wxClient = wxClient;
    this.commands = {
      lg: () => Object.keys(wxClient.groupList).map((key, index) => `${index}:${wxClient.groupList[key].NickName}`).join('\n\n'),
      lr: () => responders.map((resp, index) => `${index}:${resp.constructor.name}`).join('\n\n'),
      sr: (groupIndex, responderIndex) => {
        const groupUserName = Object.keys(wxClient.groupList).map(key => key)[groupIndex];
        const responder = responders[responderIndex];
        wxClient.respondGroupMsgWith(responder, groupUserName);
      }
    }
  }

  onText(message, reply, ctx) {
    debugger;
    if(ctx.isFromMySelf) {
      const args = message.split(' ');
      const command = args.shift();
      if(this.commands.hasOwnProperty(command)){
        reply(this.commands[command].apply(this, args));
      }
    }
  }
}

module.exports = AdminResponder;
