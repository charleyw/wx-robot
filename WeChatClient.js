'use strict';
const EventEmitter2 = require('eventemitter2').EventEmitter2;
var qrcode = require('qrcode-terminal');
const request = require('request').defaults({jar: true});
const open = require('open');
const Log = require('log');
const log = new Log('info');

const GROUP = 'group';
const SINGLE = 'single';

class WeChatClient {
  constructor() {
    this.checkLoginStatus = this.checkLoginStatus.bind(this);
    this.getLoginInfo = this.getLoginInfo.bind(this);
    this.webInit = this.webInit.bind(this);
    this.statusNotify = this.statusNotify.bind(this);
    this.processUserLoginData = this.processUserLoginData.bind(this);
    this.startEventEmitter = this.startEventEmitter.bind(this);
    this.registerResponder = this.registerResponder.bind(this);
    this.sendMsg = this.sendMsg.bind(this);
    this.buildGroupContext = this.buildGroupContext.bind(this);

    this.responders = {};
    this.syncCheckRetries = 3;
    this.getNewMsgRetries = 3;
  }

  respondWith(responder, condition){
    condition = condition || '*';
    const responderKey = responder.constructor.name + ':' + condition;
    if(this.responders.hasOwnProperty(responderKey)){
      log.warning(`Responder: ${responderKey} already registered!`)
    } else {
      this.registerResponder(condition, responder);
      this.responders[responderKey] = {condition: condition, responder: responder};
    }
  }

  respondGroupMsgWith(responder, condition) {
    condition = condition || '*';
    this.respondWith(responder, GROUP + '.' + condition);
  }

  respondSingleMsgWith(responder, condition) {
    condition = condition || '*';
    this.respondWith(responder, SINGLE + '.' + condition);
  }

  startEventEmitter() {
    log.info("Starting event emitter");

    const that = this;
    const emitter = new EventEmitter2({wildcard: true});

    emitter.on('new-messages-got', function (message) {
      log.info("event received: [new-messages-got]");
      that.getNewMsgRetries = 3;

      message.AddMsgList && message.AddMsgList.forEach(message => {
        const fromUserName = message.FromUserName == that.user.UserName ? message.ToUserName : message.FromUserName;
        const messageScope = fromUserName.startsWith('@@') ?  GROUP : SINGLE;
        switch (message.MsgType) {
          case 1:
            const eventKey = ['message', messageScope, fromUserName, 'text'].join('.');
            log.info('Emit Event: ' + eventKey);
            emitter.emit(eventKey, message);
            break;
          default:
            log.warning("Unsupported message type!")
        }
      });

      that.joinnedSyncKey = message.SyncKey.List.map(entry => entry.Key + '_' + entry.Val).join('|');
      emitter.emit('new-sync-key-got', that.joinnedSyncKey)
    });

    emitter.on('new-sync-key-got', joinedSyncKey => {
      log.info("event received: [new-sync-key-got]", joinedSyncKey);
      that.syncCheck(joinedSyncKey).then(hasMessage => emitter.emit('sync-check-finished', hasMessage), err => emitter.emit('sync-check-failed', err))
    });

    emitter.on('sync-check-finished', hasMessages => {
      that.syncCheckRetries = 3;
      log.info("event received: [sync-check-finished]");
      hasMessages ? that.getNewMsg().then(message => emitter.emit('new-messages-got', message), err => emitter.emit('get-new-message-failed', err)) : emitter.emit('new-sync-key-got', that.joinnedSyncKey)
    });

    emitter.on('get-new-message-failed', err => {
      log.info("event received: [get-new-message-failed]");
      log.error("Get new message failed: ", err);
      if(that.getNewMsgRetries > 0){
        that.getNewMsgRetries -= 1;
        log.info("Start to retry getNewMsg, retries left", that.getNewMsgRetries);
        emitter.emit('sync-check-finished', true);
      }
    });

    emitter.on('sync-check-failed', err => {
      log.info("event received: [sync-check-failed]");
      log.error("Sync check failed: ", err);
      if(that.syncCheckRetries > 0){
        that.syncCheckRetries -= 1;
        log.info("Start to retry syncCheck, retries left", that.syncCheckRetries);
        emitter.emit('new-sync-key-got', that.joinnedSyncKey)
      }
    });

    emitter.on('error', error => {
      log.error(error)
    });

    this.emitter = emitter;

    this.responders && Object.keys(this.responders).forEach(function(key){
      const respConfig = that.responders[key];
      that.registerResponder(respConfig.condition, respConfig.responder);
    });

    return Promise.resolve();
  }

  registerResponder(condition, responder) {
    const that = this;
    const msgEvent = 'message.' + condition + '.**';

    if(!!this.emitter){
      log.info(`Register responder [${responder.constructor.name}] on: [${msgEvent}]`);
      this.emitter.on(msgEvent, function(msg){
        log.info(`Event received [${this.event}]`);
        const events = this.event.split('.');
        if(events.length < 4){
          log.warning('Invalid message event received: ' + this.event)
        } else {
          const isGroupMsg = events[1] == GROUP;
          const fromUserName = events[2];
          switch (events[3]){
            case 'text':
              if(isGroupMsg){
                const groupMsgContext = that.buildGroupContext(msg, fromUserName);
                const reply = response => that.sendMsg(fromUserName, response);
                responder.onText(groupMsgContext.message, reply, groupMsgContext);
              } else {
                const singleMsgContext = {
                  fromUserName: fromUserName,
                  isFromMySelf: msg.FromUserName == that.user.UserName,
                  message: msg.Content
                };
                const reply = response => that.sendMsg(singleMsgContext.fromUserName, response);
                responder.onText(singleMsgContext.message, reply, singleMsgContext);
              }
              break;
            default:
              log.warning(`Unsupported message type [${events[4]}] received`)
          }
        }
      });
    }
  }

  buildGroupContext(msg, fromUserName) {
    const results = msg.Content.match(/(@\w+)?:?(<br\/>)?(.*)/);
    return {
      isChatRoom: true,
      groupUserName: fromUserName,
      fromUserName: msg.FromUserName == this.user.UserName ? msg.FromUserName : results[1],
      isFromMySelf: msg.FromUserName == this.user.UserName,
      mentioned: results[3].startsWith('@' + this.user.NickName),
      message: results[3]
    }
  }

  login() {
    return this.getQRUUID()
      .then(this.printQRCode)
      .then(this.checkLoginStatus)
      .then(this.getLoginInfo)
      .then(this.webInit)
      .then(this.processUserLoginData)
      .then(this.statusNotify)
      .then(this.startEventEmitter)
      .then(() => {
        setTimeout(() => this.emitter.emit('new-sync-key-got', this.joinnedSyncKey), 500);
        return Promise.resolve();
      })
      .then(() => Promise.resolve(this.user.UserName), err => log.error(err));
  }

  sendMsg(toUser, text) {
    const that = this;
    return new Promise((resolve, reject) => {
      const msgID = new Date().getTime();
      log.info(`Starting send message to: [${toUser}] with [${text}], ID: ${msgID}`);
      request.post({
        uri: that.url + '/webwxsendmsg',
        body: {
          BaseRequest: Object.assign({}, that.baseRequest, {DeviceID: 'e' + msgID}),
          Msg: {
            ClientMsgId: msgID,
            Content: text,
            FromUserName: that.user.UserName,
            LocalID: msgID,
            ToUserName: toUser,
            Type: 1
          }
        },
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        json: true
      }, (err, resp, body) => {
        if (!err) {
          log.info(`Message [${msgID}] sent: `, body);
          resolve(body)
        } else {
          log.error(`Message [${msgID}] failed to send!`);
          reject(err)
        }
      })
    })
  }

  getNewMsg() {
    const that = this;
    return new Promise((resolve, reject) => {
      log.info("Start to get new message");
      request.post({
        uri: that.url + `/webwxsync?sid=${that.loginInfo.wxsid}&skey=${that.loginInfo.skey}`,
        body: {
          BaseRequest: that.baseRequest,
          SyncKey: that.SyncKey,
          rr: new Date().getTime()
        },
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        json: true
      }, (err, resp, body) => {
        if (!err) {
          log.info("Get new messages successfully: >> message omitted <<");
          that.SyncKey = body.SyncKey;
          resolve(body)
        } else {
          log.error("Get new messages failed" + JSON.stringify(err));
          reject(err)
        }
      })
    })
  }

  syncCheck(synckey) {
    const that = this;
    return new Promise((resolve, reject) => {
      log.info("Start sync check");
      request({
        uri: that.url + '/synccheck',
        qs: {
          r: new Date().getTime(),
          skey: that.loginInfo.skey,
          sid: that.loginInfo.wxsid,
          uin: that.loginInfo.wxuin,
          deviceid: that.loginInfo.pass_ticket,
          synckey: synckey
        }
      }, (err, resp, body) => {
        if (!err) {
          log.info("Sync check successfully: " + JSON.stringify(body));

          const matchResults = body.match('window.synccheck={retcode:"(\\d+)",selector:"(\\d+)"}');
          if (matchResults) {
            if (matchResults[1] !== '0') {
              log.error('SyncCheck Failed: ' + body, '\nMatch results: ', matchResults);
              resolve(false)
            } else {
              resolve(matchResults[2] !== '0')
            }
          }
        } else {
          log.error("Sync check failed: " + JSON.stringify(err));
          reject(err)
        }
      })
    })
  }

  statusNotify(userData) {
    const that = this;
    return new Promise((resolve, reject) => {
      request.post({
        uri: that.url + '/webwxinit?r=' + new Date().getTime(),
        body: {
          BaseRequest: that.baseRequest,
          Code: 3,
          FromUserName: userData.UserName,
          ToUserName: userData.UserName,
          ClientMsgId: new Date().getTime()
        },
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        json: true
      }, (err, resp, body) => {
        if (!err) {
          resolve(body)
        } else {
          reject(err)
        }
      })
    })
  }

  processUserLoginData(data) {
    this.user = data.User;
    this.groupList = {};
    data.ContactList.forEach(contact => {
      if(contact.UserName.startsWith('@@')){
        this.groupList[contact.UserName] = {NickName: contact.NickName}
      }
    });
    this.SyncKey = data.SyncKey;
    this.joinnedSyncKey = data.SyncKey.List.map(entry => entry.Key + '_' + entry.Val).join('|');
    return new Promise(resolve => resolve(this.user))
  }

  webInit(baseRequest) {
    const that = this;
    return new Promise((resolve, reject) => {
      log.info("Start Web init");
      request.post({
        uri: that.url + '/webwxinit?r=' + new Date().getTime(),
        body: {BaseRequest: baseRequest},
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        json: true
      }, (err, resp, body) => {
        if (!err) {
          log.info("Web init successfully: >> data omitted! <<");
          resolve(body)
        } else {
          log.error("Web init failed: " + JSON.stringify(err));
          reject(err)
        }
      })
    })
  }

  getLoginInfo(url) {
    const that = this;
    this.url = url.substr(0, url.lastIndexOf('/'));
    return new Promise((resolve, reject) => {
      log.info("Start fetching login info");
      request({url: url, followRedirect: false}, (err, resp, body) => {
        if (!err) {
          const matchResults = body.match(/.*<(skey)>(.*?)<\/\1><(wxsid)>(.*?)<\/\3><(wxuin)>(.*?)<\/\5><(pass_ticket)>(.*?)<\/\7>/);
          if (matchResults) {
            that.loginInfo = {
              skey: matchResults[2],
              wxsid: matchResults[4],
              wxuin: matchResults[6],
              pass_ticket: matchResults[8]
            };

            this.baseRequest = {
              Skey: matchResults[2],
              Sid: matchResults[4],
              Uin: matchResults[6],
              DeviceID: matchResults[8]
            };
            log.info("Fetch login info successfully: " + JSON.stringify(that.loginInfo));
            resolve(this.baseRequest)
          }
        } else {
          log.error("Failed fetching login info" + JSON.stringify(err));
          reject(err)
        }
      })
    })
  }

  checkLoginStatus(uuid) {
    const that = this;
    return new Promise((resolve, reject) => {
      const url = `https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login?loginicon=true&uuid=${uuid}&tip=0&_=${new Date().getTime()}`;

      log.info("Start checking login status");
      request(url, (err, resp, body) => {
        if (!err && resp.statusCode == 200) {
          const results = body.match(/window.code\s*=\s*(\d+)/);
          if (results && results[1] == '201') {
            log.warning("Waiting for user press confirm button");
            that.checkLoginStatus(uuid).then(resolve)
          } else if (results && results[1] == '200') {
            log.info("Check login successfully");
            resolve(body.match(/window.redirect_uri="(\S+)";/)[1])
          } else {
            log.error("Check login status failed" + JSON.stringify(body));
            reject(body)
          }
        } else {
          log.error("Check login status failed" + JSON.stringify(body));
          reject(err)
        }
      })
    })
  }

  printQRCode(uuid) {
    log.info('QR Code Url: https://login.weixin.qq.com/qrcode/' + uuid);

    //qrcode.generate('https://login.weixin.qq.com/l/' + uuid);
    //open('https://login.weixin.qq.com/qrcode/' + uuid);
    return new Promise((resolve, reject) => {
      resolve(uuid)
    })
  }

  getQRUUID() {
    return new Promise((resolve, reject) => {
      log.info("Start to request UUID");
      const url = 'https://login.weixin.qq.com/jslogin?appid=wx782c26e4c19acffb&redirect_uri=https%3A%2F%2Fwx.qq.com%2Fcgi-bin%2Fmmwebwx-bin%2Fwebwxnewloginpage&fun=new&lang=en_US&_=' + new Date().getTime();
      request(url, (err, resp, body) => {
        if (!err && resp.statusCode == 200) {
          const results = body.match(/window\.QRLogin\.code = (\d+); window\.QRLogin\.uuid = "(\S+?)";/);
          if (results && results[1] === '200') {
            log.info("Successful get UUID: " + results[2]);
            resolve(results[2])
          } else {
            log.error("Failed to get UUID!");
            reject('UUID response not correct: ' + JSON.stringify(body))
          }
        } else {
          reject('Get uuid failed: ' + JSON.stringify(err))
        }
      })
    })
  }
}

module.exports = WeChatClient;