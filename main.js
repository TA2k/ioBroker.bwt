"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const qs = require("qs");
const Json2iob = require("./lib/json2iob");
const tough = require("tough-cookie");
const { HttpsCookieAgent } = require("http-cookie-agent");

class Bwt extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "bwt",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.deviceArray = [];
        this.json2iob = new Json2iob(this);
        this.ignoreState = [];
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        this.cookieJar = new tough.CookieJar();
        this.requestClient = axios.create({
            jar: this.cookieJar,
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
        this.subscribeStates("*");
        if (this.config.localIp) {
            await this.localLogin();
            await this.updateLocalDevices();
            this.updateInterval = setInterval(async () => {
                await this.updateLocalDevices();
            }, this.config.localInterval * 60 * 1000);
            this.refreshTokenInterval = setInterval(() => {
                this.localLogin();
            }, 10 * 60 * 1000);
        }
    }
    async localLogin() {
        this.log.info("local login");
        await this.requestClient({
            method: "post",
            url: "https://" + this.config.localIp + "/users/login?url=%2Fusers%2Flogin",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Connection: "keep-alive",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            },
            jar: this.cookieJar,
            withCredentials: true,
            data: "STLoginPWField=" + this.config.password + "&function=save&_method=POST",
        })
            .then((res) => {
                this.log.info(JSON.stringify(res.data));
            })
            .catch((error) => {
                this.log.error(error);
                if (error.response) {
                    this.log.error(JSON.stringify(error.response.data));
                }
            });
    }

    async updateLocalDevices() {
        const statusArray = [
            {
                path: "actualizedata",
                url: "https://" + this.config.localIp + "/home/actualizedata",
            },
            {
                path: "wasserverbrauch",
                url: "https://" + this.config.localIp + "/chart/update",
            },
        ];

        const headers = {
            accept: "*/*",
        };
        statusArray.forEach(async (element) => {
            const url = element.url;

            await this.requestClient({
                method: "get",
                url: url,
                headers: headers,
                jar: this.cookieJar,
                withCredentials: true,
            })
                .then((res) => {
                    this.log.debug(JSON.stringify(res.data));

                    const data = res.data;

                    const forceIndex = null;
                    const preferedArrayName = null;

                    this.json2iob.parse(element.path, data, { forceIndex: forceIndex, preferedArrayName: preferedArrayName });
                })
                .catch((error) => {
                    if (error.response) {
                        if (error.response.status === 401 || error.response.status === 302) {
                            error.response && this.log.debug(JSON.stringify(error.response.data));
                            this.log.info(element.path + " receive 401 or 302 error. Refresh Token in 60 seconds");
                            this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
                            this.refreshTokenTimeout = setTimeout(() => {
                                this.localLogin();
                            }, 1000 * 60);

                            return;
                        }
                    }
                    this.log.error(url);
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        });
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
            this.setState("info.connection", false, true);
            this.refreshTimeout && clearTimeout(this.refreshTimeout);
            this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
            this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
            this.updateInterval && clearInterval(this.updateInterval);
            this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
            }
        }
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
