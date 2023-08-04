new class {
    constructor() {
        document.addEventListener('DOMContentLoaded', _ => {
            this.ws = new u_socket(this.auth_data, (my_data) => this.init(my_data))
            this.original_title = document.title
            this.init_ws()
            this.init_dom()
            this.ws.connect()
        })
    }
    init_dom() {
        document.querySelector('.send_area').addEventListener('keypress', (k) => {
            if (k.key === 'Enter') this.send_message()
        })
        document.querySelector('.send_button').addEventListener('click', (k) => this.send_message())
        window.onblur = () => this.background = true
        window.onfocus = () => {
            this.background = false
            clearInterval(this.blink_title)
            document.title = this.original_title
        }
        document.querySelector('.left').onclick = () => document.querySelector('.send_area').focus()
        document.querySelector('.messages').onclick = () => document.querySelector('.send_area').focus()
        document.querySelector('.right').onclick = () => document.querySelector('.send_area').focus()
        document.querySelectorAll('.menu_button').forEach(e => {
            e.onclick = () => { this.load_modal(e.getAttribute('data-target')) }
        })
        document.querySelector('.modal_background').onclick = () => {
            this.close_modal()
        }
        this.disable_autocomplete()
    }
    close_modal() {
        document.querySelector('.modal').style.display = "none"
        document.querySelector('.send_area').focus()
        setTimeout(() => {
            let el = document.querySelector('.messages')
            el.scrollTop = el.scrollHeight
        }, 1000)

    }
    load_modal(modal_template) {
        if (!modal_template) return false
        let modal_content = document.querySelector(`#${modal_template}_modal`)
        if (!modal_content) return false
        modal_content = modal_content.innerHTML
        let modal_content_element = document.querySelector('.modal_content')
        if (!modal_content_element) return false
        document.querySelector('.modal').style.display = "block"
        modal_content_element.innerHTML = modal_content
        modal_content_element.style.marginLeft = `calc(50% - ${modal_content_element.offsetWidth / 2}px)`
        this.disable_autocomplete()
        let inp = modal_content_element.querySelector('input')
        if (typeof this[`${modal_template}_modal`] === 'function') this[`${modal_template}_modal`](modal_content_element)
        if (inp) {
            inp.focus()
            inp.select()
        }
        modal_content_element.querySelectorAll('input').forEach(e => e.addEventListener('keypress', (k) => {
            if (k.key !== 'Enter') return
            document.querySelector('.modal').style.display = 'none'
            document.querySelector('.send_area').focus()
        }))

    }
    init_ws() {
        this.ws.on('room.data', room => this.init_room(room))
        this.ws.on('room.join', data => {
            if (data.room === this.room?.name) this.render_user(data.user)
        })
        this.ws.on('room.leave', data => {
            if (data.room === this.room?.name) document.querySelector(`#user-${data.user}`)?.remove()
        })
        this.ws.on('room.left', room_name => this.remove_room(room_name))
        this.ws.on('user.nick', (data) => {
            let room = this.ws.rooms.get(data.room)
            if (!room) return false
            let user = room.users.get(data.id)
            if (!user) return false
            if (room.name === this.room?.name) this.render_users()
        })
    }
    time() {
        let MyDate = new Date()
        return [('0' + MyDate.getHours()).slice(-2), ('0' + (MyDate.getMinutes() + 1)).slice(-2), ('0' + (MyDate.getSeconds() + 1)).slice(-2)].join(':')
    }
    template_item(template, destination) {
        let templet_item = document.querySelector(template).innerHTML
        let item = document.querySelector(destination).appendChild(document.createElement('div'))
        item.classList.add(template.replace('#', '').replace('.', ''))
        item.innerHTML = templet_item
        return item
    }
    format_id(txt) {
        return btoa(txt).split('=').join('-')
    }
    remove_room(room_name) {
        document.querySelector(`#room-${this.format_id(room_name)}`)?.remove()
        document.querySelectorAll('.room_item').forEach(item => item.querySelector('.name').style.color = "var(--border-color)")
        if (this.room.name !== room_name) return true
        document.querySelector('.right').innerHTML = ''

        this.room = this.ws.rooms.get(Array.from(this.ws.rooms.values()).slice(-1)[0]?.name)
        if (this.room) document.querySelector(`#room-${this.room.name}`).querySelector('.name').style.color = "var(--blueish)"
        this.render_users()
        this.render_messages()
    }
    init_room(room) {
        room.on('msg', (data, user) => {
            let msg = `[${this.time()}][${user.nick}] ${data.toString()}`
            room.messages.push(msg)
            if (this.room?.name === room.name) this.render_message(msg)
            else {
                let r = document.querySelector(`#room-${this.format_id(room.name)}`)?.querySelector('.name')
                room.unread = true
                if (r) r.style.color = "var(--orangish)"
            }
            if (this.background) {
                clearInterval(this.blink_title)
                this.blink_title = setInterval(() => {
                    if (document.title === this.original_title) document.title = 'New message'
                    else document.title = this.original_title
                }, 500)
            }
        })
        room.messages = []
        document.querySelector('.messages').innerHTML = ''
        let old_room = document.querySelector(`#room-${this.format_id(this.room?.name)}`)
        if (old_room) old_room.querySelector('.name').style.color = "var(--border-color)"
        this.room = room
        this.render_room(room)
        this.render_users()
    }
    render_room(room) {
        let item = this.template_item('#room_item', '.left')
        item.querySelector('.name').innerHTML = room.name
        item.id = `room-${this.format_id(room.name)}`
        item.onclick = () => {
            room.unread = false
            let old_room = document.querySelector(`#room-${this.format_id(this.room?.name)}`)
            if (old_room) old_room.querySelector('.name').style.color = "var(--border-color)"
            item.querySelector('.name').style.color = "var(--blueish)"
            this.room = room
            this.render_users()
            this.render_messages()
        }
        item.querySelector('.close').onclick = () => this.ws.signal('leave', room.name)
        if (room.name === this.room?.name) item.querySelector('.name').style.color = "var(--blueish)"
        else if (room.unread) item.querySelector('.name').style.color = "var(--orangish)"
    }
    render_messages() {
        document.querySelector('.send_area').focus()
        if (!this.room) return false
        document.querySelector('.messages').innerHTML = ''
        this.room.messages.map(m => this.render_message(m))
    }
    render_message(msg) {
        let item = this.template_item('#message_item', '.messages')
        item.querySelector('.message').innerHTML = msg
        let el = document.querySelector('.messages')
        el.scrollTop = el.scrollHeight
    }
    send_message() {
        let msg = document.querySelector('.send_area').value.trim()
        if (!msg) return
        if (msg.charAt(0) === '/') {
            const short_cuts = {
                '/j': '/join',
                '/l': '/leave',
                '/n': '/nick',
            }
            Object.keys(short_cuts).map(k => msg = msg.replace(`${k} `, `${short_cuts[k]} `))
            msg = msg.substring(1).split(' ')
            let cmd = msg.shift()
            msg = msg.join(' ')
            this.ws.signal(cmd, msg)
            document.querySelector('.send_area').value = ''
        } else {
            if (!this.room) return false
            if (this.room.send('msg', msg)) document.querySelector('.send_area').value = ''
        }
        return true
    }
    init(data) {
        this.my_data = data
        this.main()
    }
    render_user(user) {
        let item = this.template_item('#user_item', '.right')
        item.id = `user-${user.id}`
        item.querySelector('.name').innerHTML = user.nick
        if (user.id === this.my_data.id) item.querySelector('.name').style.color = "var(--blueish)"
    }
    render_rooms() {
        document.querySelector('.left').innerHTML = ''
        this.ws.rooms.forEach(r => this.render_room(r))
    }
    render_users() {
        if (!this.room) return false
        document.querySelector('.right').innerHTML = ''
        this.room.users.forEach(u => this.render_user(u))
    }
    main() {
        document.querySelector('.send_area').focus()
    }

    //---- modal pages
    disable_autocomplete() {
        const inputs = document.querySelectorAll('input')
        inputs.forEach(input => {
            input.setAttribute('autocomplete', 'off')
            input.setAttribute('autocorrect', 'off')
            input.setAttribute('autocapitalize', 'off')
            input.setAttribute('spellcheck', false)
        })
    }
    settings_modal(modal) {
        let nick = modal.querySelector('.nick')
        nick.value = this.ws.me.nick
        let nick_change = () => {
            clearTimeout(modal.nick_change_timeout)
            let new_nick = nick.value
            modal.nick_change_timeout = setTimeout(() => this.ws.signal('nick', new_nick), 500)
        }
        nick.onchange = () => nick_change()
        nick.addEventListener('keyup', () => nick_change())
    }
    join_room_modal(modal) {
        let room_name = modal.querySelector('.room_name')
        room_name.addEventListener('keypress', (k) => {
            if (k.key === 'Enter') {
                this.ws.signal('join', room_name.value)
            }
        })
        modal.querySelector('.join').onclick = () => {
            this.ws.signal('join', room_name.value)
            this.close_modal()
        }
    }

}
