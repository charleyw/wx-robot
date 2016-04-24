'use strict';
const WeChatClient = require('./WeChatClient');

class DefaultResponder {
  onText(message) {
    console.log(message.Content)
  }
}

const client = new WeChatClient();
client.respondWith('singlemessage.*', new DefaultResponder());
client.login();
