'use strict';
const WeChatClient = require('./WeChatClient');

const TuLinRobotResponder = require('./responders/TuLinRobot');
const AdminResponder = require('./responders/AdminResponder');

class DefaultResponder {
  onText(message, reply) {
    console.log(message.Content);
    reply('Echo: ' + message.Content);
  }
}

const client = new WeChatClient();
//client.respondWith('singlemessage.*', new DefaultResponder());
//client.respondWith('singlemessage.*', new TuLinRobotResponder());
client.respondSingleMsgWith(new TuLinRobotResponder());
client.respondSingleMsgWith(new AdminResponder(client))
client.login()
