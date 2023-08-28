#!/usr/bin/env node
/**
 * This is the API module to facilitate connection to the nisient IoTransit WebSocket Bridge.
 *
 * @module iotransit-wb.js
 * @version 1.0.0
 * @file iotransit-wb.js
 * @copyright nisient pty. ltd. 2023
 * @license
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const EventEmitter = require('events');
const WebSocketClient = require('websocket').client;

const AUTH_USER = 'api1';
const AUTH_PASS = 'external';
const APPBRIDGE_URI = '127.0.0.1';
const WEBSOCKETBRIDGE_URI = '127.0.0.1';
const WEBSOCKETBRIDGE_PORT = 444;
const WEBSOCKETBRIDGE_SUBPROTOCOL = 'wb.iotransit.net';
const WEBSOCKETBRIDGE_ORIGIN = 'bridge';
const AUTO_RECONNECT = true;
const RECONNECTION_TIMER = 5000;
const SECURE_WEBSOCKET = true;

class IoTransitWB extends EventEmitter {

	constructor (options) {
		// the constructor accepts either a string ('appletId'), or an object that must include the appletId key, plus any
		// other of the options that require changing from default values.
		super();
		if (options === null || options === undefined) {
			throw new Error('mandatory appletId not passed to constructor');
		} else if (typeof options === 'object') {
			this.options = options;
			if (!this.options.hasOwnProperty('appletId')) throw new Error('mandatory appletId not provided in config');
		} else if (typeof options === 'string') {
			this.options = {};
			this.options.appletId = options;
		}
		if (!this.options.hasOwnProperty('accepts')) {
			this.options.acceptTags = [this.options.appletId];
		} else {
			if (!Array.isArray(this.options.accepts) && typeof this.options.accepts === 'string') {
				this.options.acceptTags = [this.options.accepts];
			} else if (Array.isArray(this.options.accepts)) {
				this.options.acceptTags = this.options.accepts;
			}
		}
		this.options.authUser = this.options && this.options.authUser || AUTH_USER;
		this.options.authPass = this.options && this.options.authPass || AUTH_PASS;
		this.options.websocketBridgeUri = this.options && this.options.websocketBridgeUri || WEBSOCKETBRIDGE_URI;
		this.options.websocketBridgePort = this.options && this.options.websocketBridgePort || WEBSOCKETBRIDGE_PORT;
		this.options.websocketBridgeSubProtocol = this.options && this.options.websocketBridgeSubProtocol || WEBSOCKETBRIDGE_SUBPROTOCOL;
		this.options.websocketBridgeOrigin = this.options && this.options.websocketBridgeOrigin || WEBSOCKETBRIDGE_ORIGIN;
		this.options.autoReconnect = this.options && this.options.hasOwnProperty('autoReconnect') ? this.options.autoReconnect : AUTO_RECONNECT;
		this.options.reconnectionTimer = this.options && this.options.reconnectionTimer || RECONNECTION_TIMER;
		this.options.secureWebSocket = this.options && this.options.hasOwnProperty('secureWebSocket') ? this.options.secureWebSocket : SECURE_WEBSOCKET;
		this.websocketBridgeConnected = false;
		this.authDevice = '';
		this.authDomain = '';
		this.authenticated = false;
	}
	
	connect () {
		// websocket bridge connection
		var webSocketPrefix = 'ws://';
		if (this.options.secureWebSocket) {webSocketPrefix = 'wss://';}
		this.wb = new WebSocketClient();
		this.wb.connect(webSocketPrefix + this.options.websocketBridgeUri + ':' + this.options.websocketBridgePort + '/', this.options.websocketBridgeSubProtocol, this.options.websocketBridgeOrigin);
		this.wb.on('connectFailed', (err) => {
			this.websocketBridgeConnected = false;
			this.emit('connectionFailed', err.toString());
			if (this.options.autoReconnect) {
				setTimeout(() => {
					this.wb.connect(webSocketPrefix + this.options.websocketBridgeUri + ':' + this.options.websocketBridgePort + '/', this.options.websocketBridgeSubProtocol, this.options.websocketBridgeOrigin);
				}, this.options.reconnectionTimer);
			}
		});
		this.wb.on('connect', (connection) => {
			connection.sendUTF(JSON.stringify({t: 'authapp', p: {user: this.options.authUser, pass: this.options.authPass, accept: this.options.acceptTags}}));
			connection.on('error', function (err) {
				this.emit('connectionError', err.toString());
			});
			connection.on('close', () => {
				this.websocketBridgeConnected = false;
				this.emit('connectionClose', 'websocket bridge connection closed');
				if (this.options.autoReconnect) {
					setTimeout(() => {
						this.wb.connect(webSocketPrefix + this.options.websocketBridgeUri + ':' + this.options.websocketBridgePort + '/', this.options.websocketBridgeSubProtocol, this.options.websocketBridgeOrigin);
					}, this.options.reconnectionTimer);
				}
			});
			this.wb.connection = connection;
			this.websocketBridgeConnected = true;
			this.emit('connection', 'websocket bridge connected');
			connection.on('message', (message) => {
				if (message.type === 'utf8') {
					var rcvMsg = JSON.parse(message.utf8Data);
					switch (rcvMsg.t) {
						default:
							if (this.options.acceptTags.indexOf(rcvMsg.t) !== -1 || rcvMsg.t === 'all') {
								this.emit('wbMessage', rcvMsg);
							}
							break;
					}
				} else if (message.type === 'binary') {
					// binary messages not currently enabled for the API
					console.log('websocket bridge client received a binary of ' + message.binaryData.length + ' bytes');
				}
			});
		});
	}
	
	disconnect () {
		// force disconnection of the websocket bridge connection.  If the autoReconnect option is set, they will
		// automatically reconnect.  If not, calling this ensures that all API connections are disconnected.
		if (this.websocketBridgeConnected) {
			this.wb.connection.drop();
		}
	}
	
	sendWB (sendMsg) {
		// send to websocket bridge
		if (this.wb.connection !== undefined && this.wb.connection.connected) {
			this.wb.connection.send(JSON.stringify(sendMsg));
		} else {
			this.emit('sendError', 'websocket bridge not connected');
		}
	}
 
}

module.exports = IoTransitWB;
