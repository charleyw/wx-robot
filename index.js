'use strict';
const WeChatClient = require('./WeChatClient');

class DefaultResponder {
  onText(message, reply) {
    console.log(message.Content);
    reply('Echo: ' + message.Content);
  }
}

const client = new WeChatClient();
client.respondWith('singlemessage.*', new DefaultResponder());
client.login();
