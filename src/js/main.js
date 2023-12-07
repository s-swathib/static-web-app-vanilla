// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

var system_prompt = `You are an AI assistant focused on delivering brief product details and assisting with the ordering process.
- Before calling a function, aim to answer product queries using existing conversational context.
- If the product information isn't clear or available, consult get_product_information for accurate details. Never invent answers.  
- Address customer account or order-related queries with the appropriate functions.
- Before seeking account specifics (like account_id), scan previous parts of the conversation. Reuse information if available, avoiding repetitive queries.
- NEVER GUESS FUNCTION INPUTS! If a user's request is unclear, request further clarification. 
- Provide responses within 3 sentences, emphasizing conciseness and accuracy.
- If not specified otherwise, the account_id of the current user is 1000
- Pay attention to the language the customer is using in their latest statement and respond in the same language!
`

// Logger
const log = msg => {
  document.getElementById('logging').innerHTML += msg + '<br>'
}

const ttsVoice = "en-US-JennyMultilingualNeural" // Update this value if you want to use a different voice
const cogSvcRegion = "westus2" // Fill your Azure cognitive services region here, e.g. westus2
const IceServerUrl = "turn:relay.communication.microsoft.com:3478"
const IceServerUsername= "BQAANmXAyIAB2iE0CgIjuChTUuN6ju7NH2owrtXiS1AAAAAMARBLzcgb+8ZGv7VTu51ROGIsrn3j1xkOsVZBYYwYaz6M5IQwJe4="
const IceServerCredential ="33qDidv0KCP3VDTvpWZCeSaDq2Y="

const cogSvcSubKey = "f22920f0f7d64ce39ec6aa9ab6ca06a1"
const azureOpenAIEndpoint ="https://ash-aiml-workspace-aoai.openai.azure.com"
const azureOpenAIApiKey = "2c0b6697ce4e4f9bacc62c224288594e"
const azureOpenAIDeploymentName ="gpt-35-turbo-16k"
const azureCogSearchEndpoint = "https://static-webapp-avatar.search.windows.net"
const azureCogSearchApiKey = "GQemWa1Jk2KSO89crwqYbiaHFVh1OqVhMhrfYGvAfdAzSeCy37rz"
const azureCogSearchIndexName = "products"

supported_languages = ["en-US", "de-DE", "zh-CN", "ar-AE"] // The language detection engine supports a maximum of 4 languages

const BackgroundColor = '#FFFFFFFF'

let token

const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL("wss://{region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?enableTalkingAvatar=true".replace("{region}", cogSvcRegion)))

// Global objects
var speechRecognizer
var speechSynthesizer
var peerConnection
var previousAnimationFrameTimestamp = 0
var messages =[]
var dataSources = []
var avatarSynthesizer
var speakingThreads = 0

var enableQuickReply = false
var quickReplies = [ 'Let me take a look.', 'Let me check.', 'One moment, please.' ]


//messages = [{ "role": "system", "content": system_prompt }];

// Setup WebRTC
function setupWebRTC(IceServerUrl, IceServerUsername, IceServerCredential) {
  // Create WebRTC peer connection
  peerConnection = new RTCPeerConnection({
    iceServers: [{
      urls: [ IceServerUrl ],
      username: IceServerUsername,
      credential: IceServerCredential
    }]
  })
  
  // Fetch WebRTC video stream and mount it to an HTML video element
  peerConnection.ontrack = function (event) {
    console.log('peerconnection.ontrack', event)
    // Clean up existing video element if there is any
    remoteVideoDiv = document.getElementById('remoteVideo')
    for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
      if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
        remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
      }
    }
    
    const videoElement = document.createElement(event.track.kind)
    videoElement.id = event.track.kind
    videoElement.srcObject = event.streams[0]
    videoElement.autoplay = true
    videoElement.controls = false
    document.getElementById('remoteVideo').appendChild(videoElement)

    canvas = document.getElementById('canvas')
    remoteVideoDiv.hidden = true
    canvas.hidden = false
    videoElement.addEventListener('play', () => {
      remoteVideoDiv.style.width = videoElement.videoWidth / 2 + 'px'
      window.requestAnimationFrame(makeBackgroundTransparent)
    })
  }
    
  // Make necessary update to the web page when the connection state changes
  peerConnection.oniceconnectionstatechange = e => {
    console.log("WebRTC status: " + peerConnection.iceConnectionState)
    
    if (peerConnection.iceConnectionState === 'connected') {
      greeting()
      document.getElementById('loginOverlay').classList.add("hidden");
    }
    
    if (peerConnection.iceConnectionState === 'disconnected') {
      }
  }
    
  // Offer to receive 1 audio, and 1 video track
  peerConnection.addTransceiver('video', { direction: 'sendrecv' })
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' })
    
  // Set local description
  peerConnection.createOffer().then(sdp => {
    peerConnection.setLocalDescription(sdp).then(() => { setTimeout(() => { connectToAvatarService() }, 1000) })
  }).catch(console.log)
}

// Initialize messages
function initMessages() {
  messages = []

  if (dataSources.length === 0) {
      let systemMessage = {
          role: 'system',
          content: system_prompt
      }

      messages.push(systemMessage)
  }
}

// Set data sources for chat API
function setDataSources(azureCogSearchEndpoint, azureCogSearchApiKey, azureCogSearchIndexName) {
  let dataSource = {
      type: 'AzureCognitiveSearch',
      parameters: {
          endpoint: azureCogSearchEndpoint,
          key: azureCogSearchApiKey,
          indexName: azureCogSearchIndexName,
          semanticConfiguration: '',
          queryType: 'simple',
          fieldsMapping: {
              contentFieldsSeparator: '\n',
              //contentFields: ['content'],
              filepathField: null,
              titleField: 'title',
              urlField: null
          },
          inScope: true,
          roleInformation: document.getElementById('prompt').value
      }
  }

  dataSources.push(dataSource)
}

// Do HTML encoding on given text
function htmlEncode(text) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };

  return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match])
}

// Speak the given text
window.speak = (text) => {
  async function speak(text) {
    addToConversationHistory(text, 'dark')

    // If there is any speaking thread, stop it
    if (speakingThreads > 0) {
      stopSpeaking()
    }

    speakingThreads++
    let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}</voice></speak>`
    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}<break time='${endingSilenceMs}ms' /></voice></speak>`
    }
    avatarSynthesizer.speakSsmlAsync(ssml).then((result) => {
      speakingThreads--
      if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
        console.log(`Speech synthesized to speaker for text [ ${text} ]`)
      } else {
        console.log(`Error occurred while speaking the SSML.`)
      }
    }).catch(
      (error) => {
        console.log(`Error occurred while speaking the SSML: [ ${error} ]`)
      })
    }
  speak(text);
}

function getQuickReply() {
  return quickReplies[Math.floor(Math.random() * quickReplies.length)]
}

// Connect to TTS Avatar API
function connectToAvatarService() {
  // Construct TTS Avatar service request
  let videoCropTopLeftX = 600
  let videoCropBottomRightX = 1320
  let backgroundColor = '#00FF00FF'

  console.log(peerConnection.localDescription)
  const clientRequest = {
    protocol: {
      name: "WebRTC",
      webrtcConfig: {
        clientDescription: btoa(JSON.stringify(peerConnection.localDescription)),
        iceServers: [{
          urls: [IceServerUrl],
          username: IceServerUsername,
          credential: IceServerCredential
        }]
      },
    },
    format: {
      codec: 'H264',
        resolution: {
            width: 1920,
            height: 1080
        },
        crop:{
            topLeft: {
                x: videoCropTopLeftX,
                y: 0
            },
            bottomRight: {
                x: videoCropBottomRightX,
                y: 1080
            }
        },
        bitrate: 2000000
    },
    talkingAvatar: {
      character: TalkingAvatarCharacter,
      style: TalkingAvatarStyle,
      background: {
          color: backgroundColor
      }
  }
  }

  // Callback function to handle the response from TTS Avatar API
  const complete_cb = function (result) {
    const sdp = result.properties.getProperty(SpeechSDK.PropertyId.TalkingAvatarService_WebRTC_SDP)
    if (sdp === undefined) {
      console.log("Failed to get remote SDP. The avatar instance is temporarily unavailable. Result ID: " + result.resultId)
      document.getElementById('startSession').disabled = false
    }

    peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sdp)))).then(r => { })
  }

  const error_cb = function (result) {
    let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
    console.log(cancellationDetails)
    document.getElementById('startSession').disabled = false
  }

  // Call TTS Avatar API
  speechSynthesizer.setupTalkingAvatarAsync(JSON.stringify(clientRequest), complete_cb, error_cb)
}

window.startSession = () => {
  //const cogSvcRegion = document.getElementById('region').value
  //const cogSvcSubKey = document.getElementById('subscriptionKey').value
  if (cogSvcSubKey === '') {
      alert('Please fill in the subscription key of your speech resource.')
      return
  }

  const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion)
  //speechSynthesisConfig.endpointId = document.getElementById('customVoiceEndpointId').value
  speechSynthesisConfig.speechSynthesisVoiceName = ttsVoice

  //const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value
  //const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value
  // This is the only avatar which supports live streaming so far, please don't modify
  const TalkingAvatarCharacter = "lisa"
  const TalkingAvatarStyle = "casual-sitting"
  const avatarConfig = new SpeechSDK.AvatarConfig(TalkingAvatarCharacter, TalkingAvatarStyle)
  //avatarConfig.customized = document.getElementById('customizedAvatar').checked
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig)
  avatarSynthesizer.avatarEventReceived = function (s, e) {
      var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms."
      if (e.offset === 0) {
          offsetMessage = ""
      }

      console.log("Event received: " + e.description + offsetMessage)
  }

  const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion)
  speechRecognitionConfig.speechRecognitionLanguage = document.getElementById('sttLocale').value
  speechRecognizer = new SpeechSDK.SpeechRecognizer(speechRecognitionConfig, SpeechSDK.AudioConfig.fromDefaultMicrophoneInput())

  //const azureOpenAIEndpoint = document.getElementById('azureOpenAIEndpoint').value
  //const azureOpenAIApiKey = document.getElementById('azureOpenAIApiKey').value
  //const azureOpenAIDeploymentName = document.getElementById('azureOpenAIDeploymentName').value
  if (azureOpenAIEndpoint === '' || azureOpenAIApiKey === '' || azureOpenAIDeploymentName === '') {
      alert('Please fill in the Azure OpenAI endpoint, API key and deployment name.')
      return
  }

  dataSources = []
  //const azureCogSearchEndpoint = document.getElementById('azureCogSearchEndpoint').value
  //const azureCogSearchApiKey = document.getElementById('azureCogSearchApiKey').value
  //const azureCogSearchIndexName = document.getElementById('azureCogSearchIndexName').value
  if (azureCogSearchEndpoint === "" || azureCogSearchApiKey === "" || azureCogSearchIndexName === "") {
    alert('Please fill in the Azure Cognitive Search endpoint, API key and index name.')
    return
  } else {
    setDataSources(azureCogSearchEndpoint, azureCogSearchApiKey, azureCogSearchIndexName)
  }

  initMessages()

  //const iceServerUrl = document.getElementById('iceServerUrl').value
  //const iceServerUsername = document.getElementById('iceServerUsername').value
  //const iceServerCredential = document.getElementById('iceServerCredential').value
  if (IceServerUrl === '' || IceServerUsername === '' || IceServerCredential === '') {
      alert('Please fill in the ICE server URL, username and credential.')
      return
  }

  document.getElementById('startSession').disabled = true
  
  setupWebRTC(IceServerUrl, IceServerUsername, IceServerCredential)
}

async function greeting() {
  addToConversationHistory("Hello, my name is Lisa. How can I help you?", "light")

  let spokenText = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice xml:lang='en-US' xml:gender='Female' name='en-US-JennyNeural'>Hello, my name is Lisa. How can I help you?</voice></speak>"
  speechSynthesizer.speakSsmlAsync(spokenText, (result) => {
    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
      console.log("Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId)
    } else {
      console.log("Unable to speak text. Result ID: " + result.resultId)
      if (result.reason === SpeechSDK.ResultReason.Canceled) {
        let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
        console.log(cancellationDetails.reason)
        if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
          console.log(cancellationDetails.errorDetails)
        }
      }
    }
  })
}


window.stopSession = () => {
  speechSynthesizer.close()
}

window.startRecording = () => {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, 'westus2');
  speechConfig.authorizationToken = token;
  speechConfig.SpeechServiceConnection_LanguageIdMode = "Continuous";
  var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(supported_languages);
  // var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(["en-US"]);

  document.getElementById('buttonIcon').className = "fas fa-stop"
  document.getElementById('startRecording').disabled = true

  recognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, autoDetectSourceLanguageConfig);

  recognizer.recognized = function (s, e) {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      console.log('Recognized:', e.result.text);
      window.stopRecording();
      // TODO: append to conversation
      window.speak(e.result.text);
    }
  };

  recognizer.startContinuousRecognitionAsync();

  console.log('Recording started.');
}

window.stopRecording = () => {
  if (recognizer) {
    recognizer.stopContinuousRecognitionAsync(
      function () {
        recognizer.close();
        recognizer = undefined;
        document.getElementById('buttonIcon').className = "fas fa-microphone"
        document.getElementById('startRecording').disabled = false
        console.log('Recording stopped.');
      },
      function (err) {
        console.error('Error stopping recording:', err);
      }
    );
  }
}

window.submitText = () => {
  document.getElementById('spokenText').textContent = document.getElementById('textinput').currentValue
  document.getElementById('textinput').currentValue = ""
  window.speak(document.getElementById('textinput').currentValue);
}


function addToConversationHistory(item, historytype) {
  const list = document.getElementById('chathistory');
  const newItem = document.createElement('li');
  newItem.classList.add('message');
  newItem.classList.add(`message--${historytype}`);
  newItem.textContent = item;
  list.appendChild(newItem);
}

function addProductToChatHistory(product) {
  const list = document.getElementById('chathistory');
  const listItem = document.createElement('li');
  listItem.classList.add('product');
  listItem.innerHTML = `
    <fluent-card class="product-card">
      <div class="product-card__header">
        <img src="${product.image_url}" alt="tent" width="100%">
      </div>
      <div class="product-card__content">
        <div><span class="product-card__price">$${product.special_offer}</span> <span class="product-card__old-price">$${product.original_price}</span></div>
        <div>${product.tagline}</div>
      </div>
    </fluent-card>
  `;
  list.appendChild(listItem);
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
  // Throttle the frame rate to 30 FPS to reduce CPU usage
  if (timestamp - previousAnimationFrameTimestamp > 30) {
      video = document.getElementById('video')
      tmpCanvas = document.getElementById('tmpCanvas')
      tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
      tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
      if (video.videoWidth > 0) {
          let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
          for (let i = 0; i < frame.data.length / 4; i++) {
              let r = frame.data[i * 4 + 0]
              let g = frame.data[i * 4 + 1]
              let b = frame.data[i * 4 + 2]
              
              if (g - 150 > r + b) {
                  // Set alpha to 0 for pixels that are close to green
                  frame.data[i * 4 + 3] = 0
              } else if (g + g > r + b) {
                  // Reduce green part of the green pixels to avoid green edge issue
                  adjustment = (g - (r + b) / 2) / 3
                  r += adjustment
                  g -= adjustment * 2
                  b += adjustment
                  frame.data[i * 4 + 0] = r
                  frame.data[i * 4 + 1] = g
                  frame.data[i * 4 + 2] = b
                  // Reduce alpha part for green pixels to make the edge smoother
                  a = Math.max(0, 255 - adjustment * 4)
                  frame.data[i * 4 + 3] = a
              }
          }

          canvas = document.getElementById('canvas')
          canvasContext = canvas.getContext('2d')
          canvasContext.putImageData(frame, 0, 0);
      }

      previousAnimationFrameTimestamp = timestamp
  }

  window.requestAnimationFrame(makeBackgroundTransparent)
}
