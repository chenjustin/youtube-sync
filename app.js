var express = require('express');
var app = express();
var path = require('path');
var bodyParser = require('body-parser');
var assert = require('assert');
var http = require("http").Server(app);
var io = require('socket.io')(http);

// process.env.PORT lets the port be set by Heroku
var port = process.env.PORT || 8080;

// Custom object
var Room = require('./libs/room.js');

// List to keep track of active rooms
var rooms = [];

var userId = 0;

//"client" folder is where express will grab static files
app.use(express.static('client'));
app.use(bodyParser.urlencoded({extended: false}));

//Folder in which express will grab templates
//app.set('views', __dirname + '/views');

//Setting the view engine
app.set('view engine', 'ejs');

app.get('/', function(req, res){
	res.render('home');
});

// Listen to port 8080
http.listen(port, function(){
	console.log("listening on " + port);
});

app.get(/^.room-\w\w\w\w\w$/, function(req, res){
	code = req.originalUrl.substring(6, 11);
	// Iterate through the list of rooms to see if it exists
	for(var i = 0; i < rooms.length; i++){
		if(rooms[i].code === code){
			res.render("room", {title: "Room " + code});
			return;
		}
	}
	res.status(404).send("Room does not exist");
});

// Create a new room
app.post('/makeRoom', function(req, rs){
	var newCode = generateRoomCode();
	
	// Create a new room and add it to the "rooms" list
	rooms.push(new Room(newCode));
	rs.redirect('/room-' + newCode)
});

// Join a room
app.post('/joinRoom', function(req, rs){
	rs.redirect('/room-' + req.body.joinRoomName);
});

function generateRoomCode(){
	var code = "";
	var charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

	for(var i = 0; i < 5; i++){
		code += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}
	return code;
}


io.on("connection", function(socket){
	var user;

	var currentRoom;

	var roomIndex;

	// Returns the room code of the connected client
	var getRoomCode = socket.handshake.query.roomCode;

	for(var i = 0; i < rooms.length; i++){
		if(rooms[i].code === getRoomCode){
			currentRoom = rooms[i];
			console.log(currentRoom);
			roomIndex = i;
			break;
		}
	}
	socket.join(getRoomCode);
	
	// When the server is alerted of a new user's connection
	socket.on("new-user", function(data){

		user = {id : userId, name : data.user};
		userId++;

		// If the room has no master, set as this user
		if(currentRoom.master === -1){
			currentRoom.master = user.id;
			user.name = "★ " + user.name
		}
		// Update its list of users
		currentRoom.people.push(user);

		// Broadcast to all clients that they must update their users list
		io.to(data.code).emit("update-users", currentRoom.people);

		// Creates a chat message saying that someone has joined the room
		io.to(data.code).emit("connection-message", user.name);
	});

	// When the server is alerted of a message being submitted
	socket.on("chat-submit", function(data){
		var chatUsername = data.user;

		// Add a "★" next to the master's chat messages
		if(currentRoom.master === user.id){
			chatUsername = "★ " + data.user;
		}

		io.to(data.code).emit("update-messages", {user: chatUsername, msg: data.msg});
	});

	socket.on("disconnect", function(){

		// Delete disconnected user from "people" list
		if(user != null){
			for(var i = 0; i < currentRoom.people.length; i++){
				if(user.id === currentRoom.people[i].id){
					var temp = currentRoom.people[i];
					currentRoom.people.splice(i, 1);

					// Set a new room master
					if(currentRoom.people[0] != null){
						if(currentRoom.people[0].id != currentRoom.master){
							currentRoom.master = currentRoom.people[0].id;
							currentRoom.people[0].name = "★ " + currentRoom.people[0].name;
						}
					}
					// If the room is empty, set master to -1
					else{
						currentRoom.master = -1;
					}

					io.to(currentRoom.code).emit("update-users", currentRoom.people);
					io.to(currentRoom.code).emit("disconnection-message", temp.name);
					break;
				}
			}
		}
		/* 
			Destroy the room if there is no one else in it after a certain amount of time.
			This "currentRoom != null" is only necessary for testing, because the app crashes when you shut down
			and restart the server while you're in a room since "currentRoom" will be null in that situation.
		*/
		if(currentRoom != null){

			// Delete the room if it's empty for 10 seconds
			setTimeout(function(){
				if(currentRoom.people.length===0){
					rooms.splice(roomIndex, 1);
					console.log("Room deleted");
				}
			}, 10000);
		}
	});

	// A client paused the video
	socket.on("pause-player", function(){
		if(currentRoom != undefined){
			// Video state 2 == PAUSED
			currentRoom.videoState = 2;
			io.to(currentRoom.code).emit("set-player-state-paused");
		}
	});

	// A client unpaused the video / the video is already playing
	socket.on("play-player", function(){
		if(currentRoom != undefined){
			// Video state 1 == PLAYING
			currentRoom.videoState = 1;
			io.to(currentRoom.code).emit("set-player-state-play");
		}
	});

	// A client has changed the video
	socket.on("change-video", function(id){
		if(currentRoom != undefined){
			currentRoom.currentVideo = id;
			io.to(currentRoom.code).emit("update-video", {videoId : id, currentTime : 0, state : 1});
		}
	});

	// When a client joins a room, it will get the currently playing video.
	socket.on("set-video", function(){
		if(currentRoom != undefined)
			socket.emit("update-video", {videoId : currentRoom.currentVideo, currentTime : currentRoom.videoTime, state : currentRoom.videoState});
	})

	// Updates the video time whenever a client seeks
	socket.on("seek-video", function(time){
		if(currentRoom != undefined)
			io.to(currentRoom.code).emit("update-currentTime", time);
	});

    // Updates the room's video time, so new clients joining the room will start at the correct time
    socket.on("update-room-time", function(time){
    	if(currentRoom != undefined){
    		currentRoom.videoTime = time;
    	}

    });
});