'use strict';

// https://github.com/fbsamples/messenger-platform-samples/blob/master/node/app.js

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const request = require('request');

const app = express();

app.set('port', process.env.PORT || 5000);

app.use(bodyParser.json({verify: verifyRequestSignature}));

const APP_SECRET = process.env.MESSENGER_APP_SECRET;
const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_TOKEN;

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
    console.error('Missing config values');
    process.exit();
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === VALIDATION_TOKEN) {
        console.log("Validating webhook");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});

app.get('/thread-setup', function(req, res) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: { access_token: PAGE_ACCESS_TOKEN },
        method: 'POST',
        json: {
            setting_type: "greeting",
            greeting: {
                "text":"Hallo! Wir antworten dir gerne auf deine Fragen. Frage doch einfach nach den nächsten Terminen!"
            }
        }
    }, function(error, response, body) {
        if (error) {
            console.error(error);
            res.send('There was an error. Look at console output.');
        } else {
            res.send('Thread was setup\n' + JSON.stringify(body));          
        }
    });
})



/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 *
 */
app.post('/webhook', function (req, res) {
    var data = req.body;

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function(pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function(messagingEvent) {
                if (messagingEvent.optin) {
                    // receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    // receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        //
        // You must send back a 200, within 20 seconds, to let us know you've
        // successfully received the callback. Otherwise, the request will time out.
        res.sendStatus(200);
    }
});


/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        // For testing, let's log an error. In production, you should throw an
        // error.
        console.error("Couldn't validate the signature.");
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}


let currentUserDialogs = {};

function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;
    var payload = event.postback.payload;
    console.log('received postback', payload);
    
    if (currentUserDialogs.hasOwnProperty(senderID)) {
        handleDialog(senderID, payload);
        return;
    } else {
        if (payload == "zeltlageranmeldung") {
            currentUserDialogs[senderID] = {
                action: "zeltlager",
                step: "first_name",
                first_name: "",
                last_name: "",
                age: "",
                schwimmer: ""
            };
            
            sendTextMessage(senderID, "Ok. Dazu brauchen wir einige Daten. Sag uns doch bitte zuerst den Vornamen der Person die du anmelden möchten.");
        }
    }
};

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}


function typing(recipientID, what) {
    request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: {
        recipient: {
            id: recipientID
        },
        sender_action: "typing_" + what
    }, function (error, response, body) {
      if (error) {
          console.error("unable to start typing");
          console.error(response);
          console.error(error);
      }
    }
  });
}



/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s", 
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });  
}

function matchesArray(message, keywords) {
    let found = false;
    
    keywords.forEach(function(keyword) {
        if (message.indexOf(keyword) !== -1) {
            found = true;
        }
    });
    
    return found; 
}

function handleDialog(senderID, text) {
    
    if (currentUserDialogs[senderID].action == "zeltlager") {
        
        if (currentUserDialogs[senderID].step == "first_name") {
            
            currentUserDialogs[senderID].first_name = text;
            currentUserDialogs[senderID].step = "last_name";
            console.log(currentUserDialogs[senderID]);
            
            sendTextMessage(senderID, "Okay. Und jetzt den Nachnamen.");
            return;
        }
        
        if (currentUserDialogs[senderID].step == "last_name") {
            
            currentUserDialogs[senderID].last_name = text;
            currentUserDialogs[senderID].step = "schwimmer";
            console.log(currentUserDialogs[senderID]);
            
            sendTextMessage(senderID, "Okay. Wie alt ist "+ currentUserDialogs[senderID].first_name + "?");
            return;
        }
        
        if (currentUserDialogs[senderID].step == "schwimmer") {
            
            currentUserDialogs[senderID].age = text;
            currentUserDialogs[senderID].step = "finished";
            console.log(currentUserDialogs[senderID]);
            
            sendMessageWithButtons(senderID, "Kann "+ currentUserDialogs[senderID].first_name + " schwimmen?", [{title: "Ja", action: "schwimmer_ja"}, {title: "Nein", action: "schwimmer_nein"}]);
            return;
        }
        
        if (currentUserDialogs[senderID].step == "finished") {
            
            if (text == "schwimmer_ja") {
                currentUserDialogs[senderID].schwimmer = true;
            }
            
            if (text == "schwimmer_nein") {
                currentUserDialogs[senderID].schwimmer = false;
            }
            
            
            console.log("NEUE ZELTLAGER ANMELDUNG:", currentUserDialogs[senderID]);
            
            sendTextMessage(senderID, "Alles klar. " + currentUserDialogs[senderID].first_name + " wurde angemeldet.");
            
            delete currentUserDialogs[senderID];
            return;
        }
    }
}

function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;
    console.log('received message: "' + message.text + '"');
    
    if (currentUserDialogs.hasOwnProperty(senderID)) {
        handleDialog(senderID, message.text);
    } else {
    
        var text = message.text.toLowerCase();
        
        if (matchesArray(text, ['hallo', 'hi', 'servus', 'griazi', 'guten tag'])) {
            typing(senderID, 'on');
            
            request('https://graph.facebook.com/v2.6/' + senderID + '?fields=first_name,last_name,gender&access_token=' + PAGE_ACCESS_TOKEN, function(error, response, body) {
                if (!error && response.statusCode == 200) {
                    let profile = JSON.parse(body);
                    sendTextMessage(senderID, "Hallo " + profile.first_name);
                    typing(senderID, 'off');
                }
            });
        }
        
        if (matchesArray(text, ['termine', 'veranstaltungen', 'events', 'geplant', 'steht an'])) {
            console.log('termine received');
            
            typing(senderID, 'on');
            
            request('https://kolping-dietfurt.de/api/termine', function(error, response, body){
                if (!error && response.statusCode == 200) {
                    let termine = JSON.parse(body);
                    
                    
                    if (matchesArray(text, ['mehr'])) {
                        sendTextMessage(senderID, 'Hier sind alle verfügbaren Termine:');
                        sendTermine(senderID, termine, 100, 5);
                    } else {
                        sendTextMessage(senderID, 'Hier sind die Termine der nächsten Zeit:');
                        sendTermine(senderID, termine);    
                    }
                    
                    typing(senderID, 'off');
                } else {
                    console.log('error getting termine from kolping-dietfurt api');
                    console.error(error);
                }
            });
        }
        
        if (matchesArray(text, ['wetter', 'regnet', 'sonnig', 'warm', 'kalt'])) {
            typing(senderID, 'on');
            request('http://api.openweathermap.org/data/2.5/weather?q=Dietfurt&units=metric&lang=de&appid=690112b1a907e822d6c496390fd4fed4', function(error, response, body) {
                if (!error && response.statusCode == 200) {
                    let weather = JSON.parse(body);
                    sendTextMessage(senderID, 'Das Wetter in Dietfurt ist zurzeit ' + weather.weather[0].description + ' bei Temperaturen zwischen ' + weather.main.temp_min + '°C und ' + weather.main.temp_max + '°C.');
                    typing(senderID, 'off');
                } else {
                    console.log('error getting weather from openweathermap.org');
                    console.error(error);
                }
            });
        }
        
        if (matchesArray(text, ['vorstand', 'vorsitzender'])) {
            sendTextMessage(senderID, "Wir haben zurzeit keinen Vorsitzenden sondern ein Leitungsteam bestehend aus: Nikolaus Landa, Simone Kuffer und Lukas Schöls.")
            sendTextMessage(senderID, "Alle Vorstandschaftsmitglieder findest du hier: https://kolping-dietfurt.de/vorstandschaft");
        }
        
        if (matchesArray(text, ['zeltlager'])) {
            sendMessageWithButtons(senderID, "Möchtest du jemanden zum Zeltlager anmelden?", [{title: "Ja", action: "zeltlageranmeldung"}]);
        }
    }
}

function sendMessageWithButtons(recipientId, message, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    text: message,
                    template_type: "button",
                    buttons: [],
                }
            }
        }
    };
    
    buttons.forEach(function(button){
        messageData.message.attachment.payload.buttons.push({
            type: "postback",
            title: button.title,
            payload: button.action
        });
    });

    callSendAPI(messageData);
}



function sendTermine(recipientID, termine, limit, start) {
    if (!limit) {
        limit = 5;
    }
    
    if (!start) {
        start = 0;
    }
    
    let messageData = {
        recipient: {
            id: recipientID
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: []
                }
            }
        }
    };
    
    if (start == 0) {
        messageData.message.quick_replies = [
            {
                content_type: "text",
                title: "Mehr Termine",
                payload: "TEST"
            }
        ];
    }
    
    termine.forEach(function(termin, index) {
        if (index < limit && index >= start) {
            var terminEntry = {
                title: termin.title,
                subtitle: termin.date,
                item_url: termin.url,
                buttons: [
                    {
                        type: "web_url",
                        url: termin.url,
                        title: "Mehr Infos"
                    }    
                ]
            };
            
            if (termin.hasOwnProperty('image')) {
                terminEntry.image_url = termin.image;
            }
            
            messageData.message.attachment.payload.elements.push(terminEntry);
        }
    });
    
    callSendAPI(messageData);
}


// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

module.exports = app;