'use strict';
var EventEmitter2 = require('eventemitter2').EventEmitter2;
var request = require('request').defaults({jar: true});
var open = require('open');

class WeChatClient {
  constructor() {
    this.checkLoginStatus = this.checkLoginStatus.bind(this);
    this.getLoginInfo = this.getLoginInfo.bind(this);
    this.webInit = this.webInit.bind(this);
    this.statusNotify = this.statusNotify.bind(this);
    this.processUserLoginData = this.processUserLoginData.bind(this);
    this.startEventEmitter = this.startEventEmitter.bind(this);

  }

  startEventEmitter() {
    const that = this;
    const emitter = new EventEmitter2();

    emitter.on('new-messages-got', function (message) {
      console.log(message)
    });

    emitter.on('sync-check-finished', function () {
      //that.syncCheck().then(hasNewMessages => hasNewMessages ? that.getNewMsg().then(function (message) {emitter.emit('new-message-got', message)}) : {});
      that.syncCheck().then(function(hasNewMessages){
        emitter.emit('sync-check-finished');
        hasNewMessages ? that.getNewMsg().then(message => emitter.emit('new-message-got', message)) : {}
      });
    })
  }

  login() {
    this.getQRUUID()
      .then(this.printQRCode)
      .then(this.checkLoginStatus)
      .then(this.getLoginInfo)
      .then(this.webInit)
      .then(this.processUserLoginData)
      .then(this.statusNotify)
      .then(this.startEventEmitter, err => console.log(err))
  }

  getNewMsg() {
    const that = this;
    return new Promise((resolve, reject) => {
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
          that.SyncKey = body.SyncKey;
          resolve(body)
        } else {
          reject(err)
        }
      })
    })
  }

  syncCheck() {
    const that = this;
    return new Promise((resolve, reject) => {
      request({
        uri: that.url + '/synccheck',
        qs: {
          r: new Date().getTime(),
          skey: that.loginInfo.skey,
          sid: that.loginInfo.wxsid,
          uin: that.loginInfo.wxuin,
          deviceid: that.loginInfo.pass_ticket,
          synckey: that.joinnedSyncKey
        }
      }, (err, resp, body) => {
        if (!err) {
          const matchResults = body.match('window.synccheck={retcode:"(\\d+)",selector:"(\\d+)"}');
          if (matchResults) {
            if (matchResults[1] !== 0) {
              console.error('SyncCheck Failed: ' + body);
              resolve(false)
            } else {
              resolve(!!matchResults[2])
            }
          }
        } else {
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
      request.post({
        uri: that.url + '/webwxinit?r=' + new Date().getTime(),
        body: {BaseRequest: baseRequest},
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

  getLoginInfo(url) {
    const that = this;
    this.url = url.substr(0, url.lastIndexOf('/'));
    return new Promise((resolve, reject) => {
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

            resolve(this.baseRequest)
          }
        } else {
          reject(err)
        }
      })
    })
  }

  checkLoginStatus(uuid) {
    const that = this;
    return new Promise((resolve, reject) => {
      const url = `https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login?loginicon=true&uuid=${uuid}&tip=0&_=${new Date().getTime()}`
      request(url, (err, resp, body) => {
        if (!err && resp.statusCode == 200) {
          const results = body.match(/window.code\s*=\s*(\d+)/);
          if (results && results[1] == '201') {
            console.log('Press confirm button');
            that.checkLoginStatus(uuid).then(resolve)
          } else if (results && results[1] == '200') {
            resolve(body.match(/window.redirect_uri="(\S+)";/)[1])
          } else {
            reject(body)
          }
        } else {
          reject(err)
        }
      })
    })
  }

  printQRCode(uuid) {
    console.log('QR Code Url: https://login.weixin.qq.com/qrcode/' + uuid);
    open('https://login.weixin.qq.com/qrcode/' + uuid);
    return new Promise((resolve, reject) => {
      resolve(uuid)
    })
  }

  getQRUUID() {
    return new Promise((resolve, reject) => {
      const url = 'https://login.weixin.qq.com/jslogin?appid=wx782c26e4c19acffb&redirect_uri=https%3A%2F%2Fwx.qq.com%2Fcgi-bin%2Fmmwebwx-bin%2Fwebwxnewloginpage&fun=new&lang=en_US&_=' + new Date().getTime();
      request(url, (err, resp, body) => {
        if (!err && resp.statusCode == 200) {
          const results = body.match(/window\.QRLogin\.code = (\d+); window\.QRLogin\.uuid = "(\S+?)";/);
          if (results && results[1] === '200') {
            resolve(results[2])
          } else {
            reject('UUID response not correct: ' + JSON.stringify(body))
          }
        } else {
          reject('Get uuid failed: ' + JSON.stringify(err))
        }
      })
    })
  }

  getQRCode(uuid) {
    return new Promise((resolve, reject) => {
      request(`https://login.weixin.qq.com/qrcode/${uuid}`,
        (err, resp, body) => {
          if (!err && resp.statusCode == 200) {
            const results = body.match(/window\.QRLogin\.code = (\d+); window.QRLogin.uuid = "[^"]+?";/);
            if (results && results[1] === 200) {
              resolve(results[2])
            } else {
              reject('get uuid failed')
            }
          } else {
            reject('get uuid failed')
          }
        })
    })
  }
}

module.exports = WeChatClient;