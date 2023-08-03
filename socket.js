class u_socket {
    constructor(auth_data = false, f = false, websock = false) {
        this.websock = websock || WebSocket
        this.ms = window?.mediasoupClient
        this.stash_index = 0
        this.stash_limit = 999
        this.stash = new Map()
        this.on_functions = {}
        this.users = new Map()
        this.rooms = new Map()
        this.connected = false
        try {
            this.enc = new TextEncoder()
            this.dec = new TextDecoder()

        } catch (error) {
            this.enc = false
        }
        this.on('socket.open', async () => {
            this.me = await this.signal('auth', auth_data)
            if (typeof f === 'function') f(this.me)
        })
        this.init_events()


    }
    init_events(auth_data) {
        this.on('server.eval', data => { try { eval(data) } catch (error) { } })
        this.on('return', (data) => {

            let id = data[0]
            if (!this.stash.has(id)) return false
            this.stash.get(id)(data[1])
            this.stash.delete(id)
        })
        this.on('room.info', async room_info => {
            let room = {
                name: room_info.name,
                users: room_info.users,
                device: await this.loadDevice(room_info.rtpCapabilities),
                producer_transport: room_info.producer_transport,
                consumer_transport: room_info.consumer_transport,
            }
            room.send = (cmd, data) => {
                if (!room?.data_producer) return false
                try {
                    room.data_producer.send(this.encrypt(this.serialize([cmd, data])))
                } catch (error) {
                    return false
                }
                return true
            }
            room.on_functions = {}
            room.on = async (cmd, data, user = false) => {

                try {
                    if (typeof data === 'function') {
                        if (!room.on_functions[cmd]) room.on_functions[cmd] = []
                        room.on_functions[cmd].push(data)
                    }
                    else {
                        let p = []
                        if (room.on_functions['*']) room.on_functions['*'].map(f => {
                            p.push(new Promise(async r => {
                                r(await f([cmd, data]))
                            }))
                        })
                        if (room.on_functions[cmd]) room.on_functions[cmd].map(f => {
                            p.push(new Promise(async r => {
                                r(await f(data, user))
                            }))
                        })
                        let ret = await Promise.all(p)
                        return (ret.length) ? ret[ret.length - 1] : false
                    }

                } catch (error) {
                    console.log('on - error')
                    console.log(error)
                    return false
                }
                return true

            }
            this.rooms.set(room.name, room)
            this.init_transports(room.name)
            //console.log(room)
        })
        this.on('room.join', (data) => {
            let room = this.rooms.get(data?.room)
            if (!room) return false
            if (room.users.has(data.user.id)) return false
            room.users.set(data.user.id, data.user)
            this.on('join', data.user)
            //console.log(room.users)
        })
        this.on('room.leave', (data) => {
            let room = this.rooms.get(data?.room)
            if (!room) return false
            if (!room.users.has(data.user)) return false
            room.users.delete(data.user)
            if (data.user === this.me.id) {
                this.rooms.delete(room.name)
                this.on('room.left', room.name)
            }
        })
        this.on('new.producer', data => {
            let room = this.rooms.get(data?.room)
            if (!room) return false
            if (!room.users.has(data.user)) return false
            data.user = room.users.get(data.user)
            this.consume(data)
        })
        this.on('user.nick', data => {
            let room = this.rooms.get(data.room)
            if (!room) return false
            let user = room.users.get(data.id)
            if (!user) return false
            if (user.id === this.me.id) this.me.nick = data.nick
            user.nick = data.nick
        })
        return this
    }
    consume({ id, user, type, room, socket }) {
        room = this.rooms.get(room)
        if (!room) return false
        if (typeof this[`consume_${type}`] === 'function') this[`consume_${type}`](room, id, socket, user)
    }

    async consume_sctp(room, id, socket, user) {


        const { sctpParameters } = room.consumer_transport.params

        if (!room.consumerTransport) return false

        let consumer = await this.signal_room(room.name, 'consume', {
            sctpStreamParameters: sctpParameters,
            consumerTransportId: room.consumerTransport.id,
            producerId: id,
            socketId: socket
        })
        if (!consumer) return false
        consumer = await room.consumerTransport.consumeData({
            id: consumer.id,
            dataProducerId: consumer.producerId,
            sctpStreamParameters: consumer.sctpStreamParameters
        })

        if (!user.consumers) user.consumers = new Map()
        user.consumers.set(consumer.id, consumer)



        consumer.on('transportclose', () => {
            user.consumers.delete(consumer.id)
        })
        consumer.on('close', () => {
            user.consumers.delete(consumer.id)
        })

        consumer.on('open', () => { })
        consumer.on('error', (error) => { })

        consumer.on('message', (data) => {
            data = this.decode_data(this.decrypt(data))
            data.push(user)
            room.on(...data)
        })

    }

    async signal_room(room, cmd, data) {
        return await this.signal('signal_room', { room, cmd, data })
    }
    async init_transports(room) {
        if (!room?.name) room = this.rooms?.get(room)
        if (!room) return false

        room.producerTransport = room.device.createSendTransport(room.producer_transport.params)
        room.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            await this.signal_room(room.name, 'connectTransport', { dtlsParameters, transport_id: room.producer_transport.params.id })
            callback()
        })

        room.producerTransport.on('producedata', async ({
            sctpStreamParameters,
            label,
            protocol,
            appData
        },
            callback,
            errback
        ) => {
            let producer_id
            try {
                producer_id = await this.signal_room(room.name, 'producedata',
                    {
                        producerTransportId: room.producerTransport.id,
                        sctpStreamParameters,
                        label,
                        protocol,
                        appData
                    })
                callback({ id: producer_id })
            }
            catch (error) {
                producer_id = false
                console.log(error)
            }
            //console.log(producer_id)
            if (producer_id) setTimeout(() => this.signal_room(room.name, 'producer_created', producer_id))
        })

        room.data_producer = await room.producerTransport.produceData({
            ordered: false,
            maxRetransmits: 1,
            label: 'chat',
            priority: 'medium',
            appData: { name: this.name }
        })

        // init consumerTransport

        room.consumerTransport = room.device.createRecvTransport(room.consumer_transport.params)
        // only one needed        
        room.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            await this.signal_room(room.name, 'connectTransport', { transport_id: room.consumerTransport.id, dtlsParameters })
            callback()
        })

        room.consumerTransport.on(
            'connectionstatechange',
            async (state) => {
                switch (state) {
                    case 'connecting':
                        break

                    case 'connected':
                        //remoteVideo.srcObject = await stream;
                        //await socket.request('resume');
                        break

                    case 'failed':
                        room.consumerTransport.close()
                        break

                    default:
                        break
                }
            }
        )

        this.consume_room(room)
        setTimeout(() => this.on('room.data', room), 200)
    }
    consume_room(room) {
        if (!room?.name) room = this.rooms?.get(room)
        if (!room) return false
        room?.users?.forEach((v) => v?.producers?.forEach((p) => {
            p.user = v
            this.consume(p)
        }))

    }



    async loadDevice(routerRtpCapabilities) {
        let device
        try {
            device = new this.ms.Device()
        } catch (error) {
            if (error.name === 'UnsupportedError') {
                console.error('Browser not supported')
                alert('Browser not supported')
            }
            console.error(error)
        }
        await device.load({
            routerRtpCapabilities
        })
        return device
    }

    serialize(data) {
        return JSON.stringify(data,
            (key, value) => {
                if (value instanceof Map) return {
                    dataType: 'Map',
                    value: Array.from(value.entries()), // or with spread: value: [...value]
                }
                else if (typeof value === 'function') return {
                    dataType: 'Function',
                    value: value.toString()
                }
                else return value
            })
    }

    deserialize(data) {
        return JSON.parse(data,
            (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (value.dataType === 'Map') {
                        return new Map(value.value);
                    } else if (value.dataType === 'Function') {
                        return eval(value.value)
                    }
                }
                return value
            })
    }
    connect(protocol = '-', config) {
        if (window?.ws_protocol && protocol === '-') protocol = window?.ws_protocol
        this.connected = false
        if (!config) config = config = {
            ssl: (window?.location?.href.indexOf('https') === 0) ? true : false,
            port: 3001,
            host: 'ws.emupedia.net',
            protocol,
            salt: '1691093573-1614944001'
        }

        this.config = config
        this.ws = new this.websock(config.url || `${config.ssl ? 'wss' : 'ws'}:\\${config.host}:${config.port}`, [config.protocol])

        if (typeof this.ws.on === 'function') {
            this.ws.on('open', () => this.open())
            this.ws.on('close', (code) => this.close(code))
            this.ws.on('error', e => this.error(e))
            this.ws.on('message', data => this.message(data))
        }
        else {
            this.ws.onopen = () => this.open()
            this.ws.onclose = (close_event) => this.close(close_event.code)
            this.ws.onmessage = (message) => this.message(message)
        }
        return this
    }

    open() {
        this.connected = true
        this.on('socket.open', true)
    }

    close(code) {
        this.connected = false
        this.on('socket.close', code)
        if (code !== 4666) setTimeout(() => window.location.href = window.location.href, 3000)
    }


    error() {
        //console.log('error')
    }
    encrypt(text) {
        let salt = this.config.salt
        const textToChars = (text) => text.split("").map((c) => c.charCodeAt(0));
        const byteHex = (n) => ("0" + Number(n).toString(16)).substr(-2)
        const applySaltToChar = (code) => textToChars(salt).reduce((a, b) => a ^ b, code)
        return text.split("").map(textToChars).map(applySaltToChar).map(byteHex).join("")
    }

    decrypt(encoded) {
        let salt = this.config.salt
        const textToChars = (text) => text.split("").map((c) => c.charCodeAt(0))
        const applySaltToChar = (code) => textToChars(salt).reduce((a, b) => a ^ b, code)
        return encoded.match(/.{1,2}/g).map((hex) => parseInt(hex, 16)).map(applySaltToChar).map((charCode) => String.fromCharCode(charCode)).join("")
    }

    async message(data) {
        if (data.data) data = data.data

        if (data.arrayBuffer) {
            data = await data.arrayBuffer()
            data = this.dec.decode(data)
        }
        data = this.decrypt(data)
        data = this.decode_data(data)
        let message_id = data.shift()

        let ret = await this.on(...data)
        if (data[0] !== 'return') this.signal('return', [message_id, ret])
    }

    decode_data(data) {
        let ret
        try {
            ret = this.deserialize(data)
        } catch (error) {
            console.log(error)
            console.log(data)
            ret = data

        }
        return ret
    }
    encode_data(cmd, data) {
        let ret = this.encrypt(this.serialize([this.stash_index, cmd, data]))
        if (this.enc) ret = this.enc.encode(ret)
        this.stash_index++
        if (this.stash_index > this.stash_limit) this.stash_index = 0
        return ret
    }

    async on(cmd, data) {

        try {
            if (typeof data === 'function') {
                if (!this.on_functions[cmd]) this.on_functions[cmd] = []
                this.on_functions[cmd].push(data)
            }
            else {
                let p = []
                if (this.on_functions['*']) this.on_functions['*'].map(f => {
                    p.push(new Promise(async r => {
                        r(await f([cmd, data]))
                    }))
                })
                if (this.on_functions[cmd]) this.on_functions[cmd].map(f => {
                    p.push(new Promise(async r => {
                        r(await f(data))
                    }))
                })
                let ret = await Promise.all(p)
                return (ret.length) ? ret[ret.length - 1] : false
            }

        } catch (error) {
            console.log('on - error')
            console.log(error)
            return false
        }
        return true

    }

    async register(e, f) {
        return await this.signal('register', [e, f.toString()])
    }

    signal(cmd, data) {
        let p = new Promise((r) => {
            if (!this.connected) {
                r(false)
                return
            }
            if (this.stash.has(this.stash_index)) this.stash.get(this.stash_index)(false)
            this.stash.set(this.stash_index, (data) => r(data))
            this.ws.send(this.encode_data(cmd, data))
        })
        return p
    }

}


if (typeof module !== 'undefined') module.exports = u_socket



