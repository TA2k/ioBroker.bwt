'use strict';

/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const qs = require('qs');
const Json2iob = require('json2iob');
const tough = require('tough-cookie');
const { HttpsCookieAgent } = require('http-cookie-agent');

class Bwt extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'bwt',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.deviceArray = [];
    this.json2iob = new Json2iob(this);
    this.ignoreState = [];
    this.cookieJar = new tough.CookieJar();
    this.requestClient = axios.create({
      withCredentials: true,
      httpsAgent: new HttpsCookieAgent({
        jar: this.cookieJar,
        rejectUnauthorized: false, // disable CA checks
      }),
    });

    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.refreshTokenTimeout = null;
    this.session = {};
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);
    if (this.config.interval < 0.1) {
      this.log.info('Set interval to minimum 0.1');
      this.config.interval = 0.1;
    }

    //  this.subscribeStates("*");
    if (this.config.localIp) {
      if (!this.config.localPassword) {
        this.log.warn('No local login code set. Please set local login code in the adapter settings');
        return;
      }
      this.log.info('Start fetching local API data from ' + this.config.localIp);
      this.log.info("You can find the Data in the Object 'local'");
      await this.extendObjectAsync('local', {
        type: 'device',
        common: {
          name: 'Data via Local API',
        },
        native: {},
      });
      await this.updateLocalDevices();
      this.updateInterval = setInterval(async () => {
        await this.updateLocalDevices(true);
      }, this.config.localInterval * 1000);
      this.hourUpdateInterval = setInterval(() => {
        this.updateLocalDevices();
      }, 60 * 60 * 1000);
    }
    if (this.config.username && this.config.password) {
      await this.login();
      if (!this.session.access_token) {
        return;
      }
      await this.getDeviceList();
      this.log.info('Found ' + this.deviceArray.length + ' devices');
      await this.updateDevices();
      this.updateInterval = setInterval(async () => {
        await this.updateDevices();
      }, this.config.interval * 60 * 1000);
      this.refreshTokenInterval = setInterval(() => {
        this.refreshToken();
      }, (this.session.expires_in - 100) * 1000);
    }
  }

  async login() {
    this.log.info('Login to App');
    const xsrf = await this.requestClient({
      method: 'get',
      url: 'https://account.bwt-group.com/?ReturnUrl=%2Fconnect%2Fauthorize%2Fcallback%3Fresponse_type%3Dcode%2520id_token%26client_id%3Dc0d4582ef6o9a4128dnmg94lz5h468cj%26scope%3Dopenid%2520offline_access%2520bwt_digital_toolbox%26nonce%3Dasd%26state%3Db64c76dee8ec45db87c2d093288bce73%26redirect_uri%3Dcom.bwt.athomeapp%253A%252F%252Foauth2redirect',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'de-de',
      },
      jar: this.cookieJar,
      withCredentials: true,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        for (const cookie of res.headers['set-cookie']) {
          if (cookie.split('=')[0] === 'XSRF-TOKEN') {
            return cookie.split('=')[1].split(';')[0];
          }
        }
      })
      .catch((error) => {
        this.log.error(error);
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
      });
    const redirectUrl = await this.requestClient({
      method: 'post',
      url: 'https://account.bwt-group.com/api/frontend/account/login',
      headers: {
        Pragma: 'no-cache',
        Accept: 'application/json, text/plain, */*',
        'X-XSRF-TOKEN': xsrf,
        'Accept-Language': 'de-de',
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
      },
      jar: this.cookieJar,
      withCredentials: true,
      data: JSON.stringify({
        email: this.config.username,
        password: this.config.password,
        RememberLogin: true,
        ReturnUrl:
          '/connect/authorize/callback?response_type=code%20id_token&client_id=c0d4582ef6o9a4128dnmg94lz5h468cj&scope=openid%20offline_access%20bwt_digital_toolbox&nonce=asd&state=b64c76dee8ec45db87c2d093288bce73&redirect_uri=com.bwt.athomeapp%3A%2F%2Foauth2redirect',
      }),
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return res.data.redirectUrl;
      })
      .catch((error) => {
        this.log.error(error);
        this.log.error('Please check username and password');
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
      });
    if (!redirectUrl) {
      return;
    }
    const code = await this.requestClient({
      method: 'get',
      url: 'https://account.bwt-group.com' + redirectUrl,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'de-de',
      },
      jar: this.cookieJar,
      withCredentials: true,
      maxRedirects: 0,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return;
      })
      .catch((error) => {
        if (error.response) {
          if (error.response.status === 302) {
            return qs.parse(error.response.headers.location.split('#')[1]).code;
          }
        }

        this.log.error(error);
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
      });
    await this.requestClient({
      method: 'post',
      url: 'https://account.bwt-group.com/auth/v2/connect/token/',
      headers: {
        Host: 'account.bwt-group.com',
        Origin: 'file://',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Accept-Language': 'de-de',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: qs.stringify({
        grant_type: 'authorization_code',
        client_id: 'c0d4582ef6o9a4128dnmg94lz5h468cj',
        client_secret: 'ow2t75HoVSf6oM6Qkzxr7OW0n2YVcWsd',
        redirect_uri: 'com.bwt.athomeapp://oauth2redirect',
        code: code,
      }),
      jar: this.cookieJar,
      withCredentials: true,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;

        this.log.info('Login to App succesfull');
        this.setState('info.connection', true, true);
      })
      .catch((error) => {
        this.log.error(error);
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
      });
  }
  async updateLocalDevices(onlyCurrent) {
    const statusArray = [
      {
        path: 'currentData',
        url: '/api/GetCurrentData',
      },
    ];
    if (!onlyCurrent) {
      statusArray.push({
        path: 'dailyData',
        url: '/api/GetDailyData',
      });
      statusArray.push({
        path: 'monthlyData',
        url: '/api/GetMonthlyData',
      });
      statusArray.push({
        path: 'yearlyData',
        url: '/api/GetYearlyData',
      });
    }

    const headers = {
      accept: '*/*',
      Authorization: 'Basic ' + Buffer.from('user:' + this.config.localPassword).toString('base64'),
    };
    statusArray.forEach(async (element) => {
      const url = element.url;

      await this.requestClient({
        method: 'get',
        url: 'http://' + this.config.localIp + ':8080' + url,
        headers: headers,
      })
        .then((res) => {
          this.setState('info.connection', true, true);
          this.log.debug(JSON.stringify(res.data));
          const data = res.data;
          this.json2iob.parse('local.' + element.path, data, { forceIndex: true });
        })
        .catch((error) => {
          this.setState('info.connection', false, true);
          this.log.error(url);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    });
  }
  async getDeviceList() {
    const deviceListUrl = [
      'https://api.bwt-group.com/api/device',
      'https://api.bwt-group.com/api/product/customer',
      'https://api.bwt-group.com/api/pools/owned',
    ];
    for (const url of deviceListUrl) {
      await this.requestClient({
        method: 'get',
        url: url,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          Authorization: 'Bearer ' + this.session.access_token,
          'Accept-Language': 'de-de',
        },
      })
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          if (!res.data.Data) {
            this.log.error('No Data in response');
            this.log.error(JSON.stringify(res.data));
            return;
          }
          for (const device of res.data.Data) {
            const vin = device.DeviceId;
            if (!vin) {
              this.log.debug('Device without id ' + device.ProductCode);
              continue;
            }
            if (this.deviceArray.indexOf(vin) === -1) {
              this.deviceArray.push(vin);
            }
            const name = device.DisplayName;

            await this.setObjectNotExistsAsync(vin, {
              type: 'device',
              common: {
                name: name,
              },
              native: {},
            });
            await this.setObjectNotExistsAsync(vin + '.general', {
              type: 'channel',
              common: {
                name: 'General Information',
              },
              native: {},
            });
            this.json2iob.parse(vin + '.general', device, { autoCast: true });
          }
        })
        .catch((error) => {
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    }
  }

  async updateDevices() {
    const curDate = new Date().toISOString().split('T')[0];
    const startTimestampMonth = new Date().setDate(new Date().getDate() - 100);
    const startDateMonthFormatted = new Date(startTimestampMonth).toISOString().split('T')[0];
    const statusArray = [
      {
        path: '.telemetry',
        url: 'https://api.bwt-group.com/api/perla/$id/telemetry',
      },
      {
        path: '.notifications',
        url: 'https://api.bwt-group.com/api/device/$id/notifications?orderAsc=true',
        forceIndex: true,
      },
      {
        path: '.limeFiltered',
        url: 'https://api.bwt-group.com/api/mobilebackend/$id/limeFiltered',
      },
      {
        path: '.waterconsumption',
        url: 'https://api.bwt-group.com/api/device/$id/waterconsumption/daily?since=' + startDateMonthFormatted + '&until=' + curDate,
        preferedArrayName: 'From',
        forceIndex: true,
      },
      {
        path: '.saltConsumption',
        url: 'https://api.bwt-group.com/api/perla/$id/saltConsumption?from=' + startDateMonthFormatted + '&aggregation=day&to=' + curDate,
        preferedArrayName: 'From',
        forceIndex: true,
      },
    ];

    const headers = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      Authorization: 'Bearer ' + this.session.access_token,
      'Accept-Language': 'de-de',
    };
    this.deviceArray.forEach(async (id) => {
      statusArray.forEach(async (element) => {
        if (this.ignoreState.includes(element.path)) {
          return;
        }
        const url = element.url.replace('$id', id);
        this.log.debug(url);
        await this.requestClient({
          method: 'get',
          url: url,
          headers: headers,
        })
          .then((res) => {
            this.log.debug(JSON.stringify(res.data));
            if (!res.data) {
              return;
            }
            const data = res.data.Data;

            let forceIndex = null;
            if (element.forceIndex) {
              forceIndex = true;
            }
            let preferedArrayName = null;
            if (element.preferedArrayName) {
              preferedArrayName = element.preferedArrayName;
            }
            this.json2iob.parse(id + element.path, data, { forceIndex: forceIndex, preferedArrayName: preferedArrayName });
          })
          .catch((error) => {
            if (error.response) {
              if (error.response.status === 401) {
                error.response && this.log.debug(JSON.stringify(error.response.data));
                this.log.info(element.path + ' receive 401 error. Refresh Token in 60 seconds');
                this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
                this.refreshTokenTimeout = setTimeout(() => {
                  this.refreshToken();
                }, 1000 * 60);

                return;
              }
              if (error.response.status === 404) {
                this.log.warn(url);
                error.response && this.log.warn(JSON.stringify(error.response.data));
                return;
              }
            }
            this.log.error(url);
            this.log.error(error);
            error.response && this.log.error(JSON.stringify(error.response.data));
          });
      });
    });

    this.getDeviceList();
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
      this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
      this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
      this.updateInterval && clearInterval(this.updateInterval);
      this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
      this.refreshLocalLoginInterval && clearInterval(this.refreshLocalLoginInterval);
      callback();
    } catch (e) {
      callback();
    }
  }
  async refreshToken() {
    await this.requestClient({
      method: 'post',
      url: 'https://account.bwt-group.com/auth/v2/connect/token/',
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Accept-Language': 'de-de',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data:
        'grant_type=refresh_token&client_id=c0d4582ef6o9a4128dnmg94lz5h468cj&client_secret=ow2t75HoVSf6oM6Qkzxr7OW0n2YVcWsd&redirect_uri=com.bwt.athomeapp%3A%2F%2Foauth2redirect&refresh_token=' +
        this.session.refresh_token,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.setState('info.connection', true, true);
      })
      .catch((error) => {
        this.log.error('refresh token failed');
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.log.error('Start relogin in 1min');
        this.reLoginTimeout = setTimeout(() => {
          this.login();
        }, 1000 * 60 * 1);
      });
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Bwt(options);
} else {
  // otherwise start the instance directly
  new Bwt();
}
