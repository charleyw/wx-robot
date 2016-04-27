'use strict';
var EventEmitter2 = require('eventemitter2').EventEmitter2;
var request = require('request').defaults({jar: true});
var open = require('open');
var Log = require('log'),
  log = new Log('info');

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

    this.responders = [];
  }

  respondWith(condition, responder){
    this.registerResponder(condition, responder);
    this.responders[condition] = responder;
  }

  startEventEmitter() {
    log.info("Starting event emitter");

    const that = this;
    const emitter = new EventEmitter2({wildcard: true});

    emitter.on('new-messages-got', function (message) {
      log.info("event received: [new-messages-got]");

      message.AddMsgList && message.AddMsgList.forEach(message => {
        const messageScope = message.FromUserName.startsWith('@@') ?  'groupmessage' : 'singlemessage';
        switch (message.MsgType) {
          case 1:
            const eventKey = ['message', messageScope, message.FromUserName, 'text'].join('.');
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
      that.syncCheck(joinedSyncKey).then(hasMessage => emitter.emit('sync-check-finished', hasMessage))
    });

    emitter.on('sync-check-finished', hasMessages => {
      log.info("event received: [sync-check-finished]");
      hasMessages ? that.getNewMsg().then(message => emitter.emit('new-messages-got', message)) : emitter.emit('new-sync-key-got', that.joinnedSyncKey)
    });

    emitter.on('error', error => {
      log.error(error)
    });

    this.emitter = emitter;

    this.responders && Object.keys(this.responders).forEach(function(key){
      that.registerResponder(key, that.responders[key]);
    });

    return Promise.resolve();
  }

  registerResponder(condition, responder) {
    const that = this;

    if(!!this.emitter){
      log.info("Register responder on: " + 'message.' + condition + '.**');
      this.emitter.on('message.' + condition + '.**', function(msg){
        log.info(`Event received [${'message' + condition + '.**'}]`);
        const events = this.event.split('.');
        if(events.length < 4){
          log.warning('Invalid message event received: ' + this.event)
        } else {
          switch (events[3]){
            case 'text':
              responder.onText(msg, response =>
                that.sendMsg(msg.FromUserName !== that.user.UserName ? msg.FromUserName : msg.ToUserName, response)
              );
              break;
            default:
              log.warning(`Unsupport message [${events[4]}] received by responder: ${condition}`)
          }
        }
      });
    }
  }

  login() {
    this.getQRUUID()
      .then(this.printQRCode)
      .then(this.checkLoginStatus)
      .then(this.getLoginInfo)
      .then(this.webInit)
      .then(this.processUserLoginData)
      .then(this.statusNotify)
      .then(this.startEventEmitter)
      .then(() => setTimeout(() => this.emitter.emit('new-sync-key-got', this.joinnedSyncKey), 500));
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
      const url = `https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login?loginicon=true&uuid=${uuid}&tip=0&_=${new Date().getTime()}`
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
    open('https://login.weixin.qq.com/qrcode/' + uuid);
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