const socket = io();

const pcConfig = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
      ],
    },
  ],
};
const videoDiv = document.querySelector("div");

const startBtn = document.querySelector("#start");
startBtn.addEventListener("click", StartChat);

InitializeToStart();

let myStream;
let myPC;
let myReceivePCs = {};

// 시작 전 미디어를 받아오고 서버에 송신하기위한 rtcpeerconnection 생성
async function InitializeToStart() {
  try {
    await GetMyStream(); // await 이유 : rtcpperconnection 생성 전 stream 먼저 받아둬야함

    startBtn.disabled = false;
  } catch (e) {
    console.log(e);
  }
}

async function GetMyStream() {
  try {
    const defaultConstrain = {
      audio: true,
      video: true,
    };
    myStream = await navigator.mediaDevices.getUserMedia(defaultConstrain);
    const myFace = document.createElement("video");
    myFace.setAttribute("id", "myFace");
    myFace.setAttribute("playsinline", "");
    myFace.setAttribute("autoplay", "");
    myFace.setAttribute("controls", "false");
    myFace.setAttribute("width", "480");
    myFace.setAttribute("height", "320");
    myFace.srcObject = myStream;
    videoDiv.appendChild(myFace);
    console.log("### 유저의 video 읽음");
    myStream.getAudioTracks()[0].enabled = false; // constrain을 false로 줄 경우 audio 안가져오므로 true로 받아오고 enable을 꺼줌
  } catch (e) {
    console.log(e);
  }
}

async function makeSendConnection() {
  myPC = new RTCPeerConnection(pcConfig);

  // sdp 결정 후 자신의 ice candidate 확보될 경우 이벤트 발생
  // ice(Interactive Connectivity Esablishment)
  // peer간 ice candidate를 서로 교환하며 최적의 경로를 찾음
  // 가능한 모든 candidate를 모두 전송
  // _data.candidate가 null인 경우도 있으므로 null이 아닌 것만 보내줘야함
  // 서로의 ice candidate를 addIceCandidate 함수를 사용해 등록해주면 됨
  myPC.onicecandidate = (_data) => {
    console.log("ice candidate 생성");
    if (_data.candidate) {
      // null일 경우엔 보내지 않음
      console.log("ice candidate 송신");
      socket.emit("sendIce", _data.candidate);
    }
  };

  // offer 생성 전 track 추가 필수
  myStream.getTracks().forEach((_track) => {
    myPC.addTrack(_track, myStream);
  });
}

function StartChat() {
  startBtn.hidden = true;
  CreateSendOffer();
}

async function CreateSendOffer() {
  try {
    makeSendConnection();
    console.log("send Offer 생성");
    const offer = await myPC.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false,
    });
    await myPC.setLocalDescription(offer);
    socket.emit("sendOffer", offer);
  } catch (e) {
    console.log(e);
  }
}

socket.on("sendAnswer", async (_answer) => {
  try {
    console.log("send answer 수신");
    await myPC.setRemoteDescription(_answer);
  } catch (e) {
    console.log(e);
  }
});

socket.on("sendIce", (_candidate) => {
  console.log("send candidate 받음!");
  myPC.addIceCandidate(_candidate);
});

socket.on("newUserJoined", (_id) => {
  if (!myReceivePCs[_id]) {
    console.log("새 유저 입장");
    CreateReceiveOffer(_id);
  }
});


// 다른 client들의 stream을 받기 위한 연결


async function CreateReceiveOffer(_id) {
  try {
    await MakeReceiveConnection(_id);
    console.log("receive offer 생성");
    const offer = await myReceivePCs[_id].pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
    });
    await myReceivePCs[_id].pc.setLocalDescription(offer);
    socket.emit("receiveOffer", offer, _id);
  } catch (e) {
    console.log(e);
  }
}
function MakeReceiveConnection(_id) {
  myReceivePCs[_id] = {
    pc: new RTCPeerConnection(pcConfig),
    stream: new MediaStream(),
  };

  myReceivePCs[_id].pc.onicecandidate = (_data) => {
    if (_data.candidate) {
      console.log("receive ice candidate 송신");
      socket.emit("receiveIce", _data.candidate, _id);
    }
  };
  myReceivePCs[_id].pc.ontrack = (_data) => {
    console.log("다른 사용지 stream 받음");
    myReceivePCs[_id].stream.addTrack(_data.track);
  };
  const peerFace = document.createElement("video");
      peerFace.setAttribute("id", _id);
      peerFace.setAttribute("playsinline", "");
      peerFace.setAttribute("autoplay", "");
      peerFace.setAttribute("controls", "false");
      peerFace.setAttribute("width", "480");
      peerFace.setAttribute("height", "320");
      peerFace.srcObject = myReceivePCs[_id].stream;
      videoDiv.appendChild(peerFace);
      console.log("새 유저의 비디오 생성");
}

socket.on("receiveAnswer", async (_answer, _id) => {
  try {
    console.log("receive answer 수신");
    await myReceivePCs[_id].pc.setRemoteDescription(_answer);
  } catch (e) {
    console.log(e);
  }
});

socket.on("receiveIce", (_candidate, _id) => {
  console.log("receive ice candidate 추가");
  myReceivePCs[_id].pc.addIceCandidate(_candidate);
});

socket.on("addOldUser", (_id)=>{
    if(!myReceivePCs[_id]){
        console.log(`기존 유저 추가: ${_id}`);
        CreateReceiveOffer(_id);
    }
});

socket.on("userExit", (_id)=>{
    delete myReceivePCs[_id];
    if(document.getElementById(_id))
        videoDiv.removeChild(document.getElementById(_id));
});




// ############### 채팅 관련 기능  ################

const tBoxInput = document.querySelector("#tBoxInput");

// 마지막으로 채팅친 사람의 이름, 닉네임 중복 출력 방지
let lastChattedName;


tBoxInput.addEventListener("keyup", EnterMessage);

function EnterMessage(event){
  if(event.keyCode == 13){  // 엔터키
    const msg = tBoxInput.value;
    // 보낼 메시지 없을 경우 수행 x
    if(msg==="")
      return;
    // socket.id 는 사용자 명으로 바꾸면 됨
    socket.emit("sendChat", msg, socket.id);
    tBoxInput.value="";


    // 내가 보낸 메시지를 내 채팅창에 띄움

    const msg_box = document.createElement('div');
    const msg_name = document.createElement('span');
    const msg_content = document.createElement('div');
    if(lastChattedName !== socket.id)
      msg_box.appendChild(msg_name);
    msg_box.appendChild(msg_content);
    msg_box.id = "chat_box";
    msg_name.id = "chat_name_me";
    msg_content.id = "chat_content_me";
  
  
    msg_name.innerText = socket.id;
    lastChattedName=socket.id;
    msg_content.innerText = msg;
  
    messageBox.appendChild(msg_box);

    // 메시지 보냈으므로 스크롤 최신화
      messageBox.scrollTo(0,messageBox.scrollHeight);

  }
}

const messageBox = document.querySelector("#messageBox");


// 채팅 메시지를 서버로부터 받은 경우
socket.on("receiveChat", (_msg, _id)=>{
  const msg_box = document.createElement('div');
  const msg_name = document.createElement('span');
  const msg_content = document.createElement('div');
  if(lastChattedName !== _id)
    msg_box.appendChild(msg_name);
  msg_box.appendChild(msg_content);
  msg_name.id = "chat_name";
  msg_content.id = "chat_content";


  msg_name.innerText = _id;
  lastChattedName = _id;
  msg_content.innerText = _msg;


  const nowScroll = Math.ceil(messageBox.scrollTop);
  let canScroll = false;
  if(nowScroll === messageBox.scrollHeight-messageBox.clientHeight)
  {
    canScroll = true;
  }

  messageBox.appendChild(msg_box);

  if(canScroll){
    messageBox.scrollTo(0,messageBox.scrollHeight);
  }
});