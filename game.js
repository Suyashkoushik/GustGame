// game.js (ES module) — plug this into a <script type="module" src="game.js"></script>
// Assumes your HTML has all the elements with the IDs used below.

// ---------------- Firebase imports ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, onSnapshot,
  serverTimestamp, getDocs, query, where, limit, orderBy
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// ---------------- Firebase config ----------------
const firebaseConfig = {
  apiKey: "AIzaSyCvUJuMrfxnF6vRp97TiE3vFTwUH-jcDvc",
  authDomain: "gustgame-1509e.firebaseapp.com",
  projectId: "gustgame-1509e",
  storageBucket: "gustgame-1509e.firebasestorage.app",
  messagingSenderId: "826073677202",
  appId: "1:826073677202:web:b0e1c96a6ad4706661554b",
  measurementId: "G-HQ3GM4D2Y3"
};

// ---------------- Init ----------------
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ---------------- DOM ----------------
const authView    = document.getElementById('auth-view');
const lobbyView   = document.getElementById('lobby-view');
const gameView    = document.getElementById('game-view');

const emailEl     = document.getElementById('email');
const passEl      = document.getElementById('password');
const unameEl     = document.getElementById('username');

const meU         = document.getElementById('me-username');
const meE         = document.getElementById('me-email');

const loginBtn    = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const logoutBtn   = document.getElementById('logoutBtn');

const quickMatchBtn     = document.getElementById('quickMatchBtn');
const searchUsernameEl  = document.getElementById('searchUsername');
const searchBtn         = document.getElementById('searchBtn');
const searchResult      = document.getElementById('searchResult');
const invitesDiv        = document.getElementById('invites');

const backBtn     = document.getElementById('backToLobby');
const boardEl     = document.getElementById('board');
const statusEl    = document.getElementById('status');

const msgDiv      = document.getElementById('messages');
const chatInput   = document.getElementById('chatInput');
const sendBtn     = document.getElementById('sendBtn');

// ---------------- State ----------------
let currentUser     = null;
let userProfile     = null;
let currentGameId   = null;
let mySymbol        = null;

let activeGameUnsub   = null;
let chatUnsub         = null;
let invitesUnsub      = null;
let myQueueUnsub      = null;
let sentChallengesUnsub = null;

// ---------------- UI Helpers ----------------
function show(view) {
  [authView, lobbyView, gameView].forEach(v => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

// ---------------- Auth / Profile ----------------
async function ensureUserProfile(u) {
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const username = (unameEl.value.trim() || u.displayName || u.email.split('@')[0]).trim();
    const usernameLower = username.toLowerCase();

    // (Optional) uniqueness check
    const qCheck = query(collection(db, 'users'), where('usernameLower', '==', usernameLower), limit(1));
    const found  = await getDocs(qCheck);
    if (!found.empty) {
      throw new Error('Username already taken. Please register with a different one.');
    }

    await setDoc(ref, {
      uid: u.uid,
      email: u.email,
      username,
      usernameLower,
      createdAt: serverTimestamp()
    });
    return { uid: u.uid, email: u.email, username, usernameLower };
  }
  return snap.data();
}

// ---------------- Game Logic ----------------
function renderBoard(board, myTurn) {
  boardEl.innerHTML = '';
  board.forEach((v, i) => {
    const c = document.createElement('div');
    c.className = 'cell' + (!myTurn || v ? ' disabled' : '');
    c.textContent = v || '';
    c.onclick = () => {
      if (myTurn && !v) makeMove(i);
    };
    boardEl.appendChild(c);
  });
}

function calcWinner(board) {
  const lines = [
    [0,1,2], [3,4,5], [6,7,8],
    [0,3,6], [1,4,7], [2,5,8],
    [0,4,8], [2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return 'tie';
  return null;
}

async function makeMove(index) {
  const ref = doc(db, 'games', currentGameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const g = snap.data();
  if (g.status !== 'playing') return;
  if (g.turn !== currentUser.uid) return;

  const board = g.board.slice();
  if (board[index]) return;

  board[index] = mySymbol;
  const w = calcWinner(board);

  const updates = {
    board,
    updatedAt: serverTimestamp()
  };

  if (w) {
    updates.status = 'done';
    updates.winner = (w === 'tie') ? 'tie' : currentUser.uid;
  } else {
    updates.turn = g.players.find(p => p !== currentUser.uid);
  }

  await updateDoc(ref, updates);
}

function listenGame(gameId) {
  if (activeGameUnsub) activeGameUnsub();
  activeGameUnsub = onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) {
      statusEl.textContent = 'Game not found.';
      return;
    }
    const g = snap.data();
    mySymbol = g.symbols[currentUser.uid];
    const isMyTurn = g.turn === currentUser.uid;

    if (g.status === 'done') {
      statusEl.textContent = (g.winner === 'tie')
        ? 'Tie!'
        : (g.winner === currentUser.uid ? 'You win!' : 'You lose!');
      renderBoard(g.board, false);
    } else {
      statusEl.textContent = isMyTurn ? 'Your turn' : 'Opponent turn';
      renderBoard(g.board, isMyTurn);
    }
  });
}

// ---------------- Chat ----------------
function listenChat() {
  if (chatUnsub) chatUnsub();
  const qChat = query(collection(db, 'games', currentGameId, 'chat'), orderBy('createdAt'));
  chatUnsub = onSnapshot(qChat, (snap) => {
    msgDiv.innerHTML = '';
    snap.forEach(m => {
      const d = m.data();
      const div = document.createElement('div');
      div.className = 'msg ' + (d.uid === currentUser.uid ? 'msg-me' : 'msg-opp');
      div.textContent = `${d.username}: ${d.text}`;
      msgDiv.appendChild(div);
    });
    msgDiv.scrollTop = msgDiv.scrollHeight;
  });
}

async function sendMsg() {
  const text = chatInput.value.trim();
  if (!text || !currentGameId) return;
  chatInput.value = '';
  await addDoc(collection(db, 'games', currentGameId, 'chat'), {
    uid: currentUser.uid,
    username: userProfile.username,
    text,
    createdAt: serverTimestamp()
  });
}

// ---------------- Quick Match ----------------
async function quickMatch() {
  // Put yourself in the queue
  const myQRef = doc(db, 'queues', currentUser.uid);
  await setDoc(myQRef, {
    uid: currentUser.uid,
    username: userProfile.username,
    available: true,
    createdAt: serverTimestamp()
  });

  // Try to find an opponent
  const qOpp = query(
    collection(db, 'queues'),
    where('available', '==', true),
    orderBy('createdAt'),
    limit(10)
  );
  const oppSnap = await getDocs(qOpp);
  let opponent = null;
  oppSnap.forEach(d => {
    const v = d.data();
    if (v.uid !== currentUser.uid && !opponent) opponent = v;
  });

  if (opponent) {
    const uids = [currentUser.uid, opponent.uid];
    const first = Math.random() < 0.5 ? uids[0] : uids[1];
    const gameRef = await addDoc(collection(db, 'games'), {
      players: uids,
      symbols: { [uids[0]]: 'X', [uids[1]]: 'O' },
      board: Array(9).fill(null),
      turn: first,
      status: 'playing',
      winner: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'queues', opponent.uid), { available: false, gameId: gameRef.id });
    await updateDoc(myQRef, { available: false, gameId: gameRef.id });

    // Optional queue cleanup
    await deleteDoc(doc(db, 'queues', opponent.uid)).catch(()=>{});
    await deleteDoc(myQRef).catch(()=>{});

    enterGame(gameRef.id);
  } else {
    // Wait for someone to pair us
    if (myQueueUnsub) myQueueUnsub();
    myQueueUnsub = onSnapshot(myQRef, async (snap) => {
      const v = snap.data();
      if (v && v.gameId) {
        if (myQueueUnsub) myQueueUnsub();
        await deleteDoc(myQRef).catch(()=>{});
        enterGame(v.gameId);
      }
    });
    alert('Waiting for opponent… keep this tab open.');
  }
}

// ---------------- Challenge by Username ----------------
async function searchByUsername(username) {
  searchResult.innerHTML = 'Searching…';
  const qUsers = query(collection(db, 'users'), where('usernameLower', '==', username.toLowerCase()), limit(1));
  const res = await getDocs(qUsers);
  if (res.empty) {
    searchResult.textContent = `User '${username}' not found.`;
    return;
  }
  const userDoc = res.docs[0];
  const user = userDoc.data();
  searchResult.innerHTML = `Found: <b>${user.username}</b> <button id="challengeBtn">Challenge</button>`;
  document.getElementById('challengeBtn').onclick = () => sendChallenge(userDoc.id, user.username);
}

async function sendChallenge(toUid, toUsername) {
  if (toUid === currentUser.uid) {
    alert('Cannot challenge yourself!');
    return;
  }
  await addDoc(collection(db, 'challenges'), {
    fromUid: currentUser.uid,
    fromUsername: userProfile.username,
    toUid,
    toUsername,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  alert('Challenge sent! Waiting for acceptance...');
}

// Listen to invites (where I'm the receiver)
function listenInvites() {
  if (invitesUnsub) invitesUnsub();
  const qInv = query(
    collection(db, 'challenges'),
    where('toUid', '==', currentUser.uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  invitesUnsub = onSnapshot(qInv, (snap) => {
    invitesDiv.innerHTML = '';
    snap.forEach(d => {
      const inv = d.data();
      const div = document.createElement('div');
      div.innerHTML = `Invite from <b>${inv.fromUsername}</b>`;
      const accept = document.createElement('button');
      accept.textContent = 'Accept';
      accept.onclick = async () => {
        const uids = [inv.fromUid, inv.toUid];
        const first = Math.random() < 0.5 ? uids[0] : uids[1];
        const gameRef = await addDoc(collection(db, 'games'), {
          players: uids,
          symbols: { [uids[0]]: 'X', [uids[1]]: 'O' },
          board: Array(9).fill(null),
          turn: first,
          status: 'playing',
          winner: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'challenges', d.id), { status: 'accepted', gameId: gameRef.id });
        enterGame(gameRef.id);
      };
      const reject = document.createElement('button');
      reject.textContent = 'Reject';
      reject.onclick = () => updateDoc(doc(db, 'challenges', d.id), { status: 'rejected' });
      div.appendChild(accept);
      div.appendChild(reject);
      invitesDiv.appendChild(div);
    });
  });
}

// Listen to sent challenges (where I'm the sender) to auto-enter game when accepted
function listenSentChallenges() {
  if (sentChallengesUnsub) sentChallengesUnsub();
  const qSent = query(
    collection(db, 'challenges'),
    where('fromUid', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  );
  sentChallengesUnsub = onSnapshot(qSent, (snap) => {
    snap.forEach((docSnap) => {
      const challenge = docSnap.data();
      if (challenge.status === 'accepted' && challenge.gameId) {
        enterGame(challenge.gameId);
      }
    });
  });
}

// ---------------- Enter / Exit game ----------------
function enterGame(gameId) {
  currentGameId = gameId;
  show(gameView);
  listenGame(gameId);
  listenChat();
}

// ---------------- Event Bindings ----------------
registerBtn.onclick = async () => {
  try {
    const username = unameEl.value.trim();
    if (!username) {
      alert('Please enter a username to register.');
      return;
    }
    const { user } = await createUserWithEmailAndPassword(auth, emailEl.value, passEl.value);
    await updateProfile(user, { displayName: username });
    userProfile = await ensureUserProfile(user);
  } catch (e) {
    alert(e.message);
  }
};

loginBtn.onclick = async () => {
  try {
    await signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
  } catch (e) {
    alert(e.message);
  }
};

logoutBtn.onclick = async () => {
  await signOut(auth);
};

quickMatchBtn.onclick = quickMatch;

searchBtn.onclick = () => {
  const u = searchUsernameEl.value.trim();
  if (u) searchByUsername(u);
};

backBtn.onclick = () => {
  if (activeGameUnsub) activeGameUnsub();
  if (chatUnsub) chatUnsub();
  currentGameId = null;
  mySymbol = null;
  show(lobbyView);
};

sendBtn.onclick = sendMsg;
chatInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') sendMsg(); });

// ---------------- Auth listener ----------------
onAuthStateChanged(auth, async (u) => {
  currentUser = u;
  if (!u) {
    show(authView);
    if (invitesUnsub) invitesUnsub();
    if (sentChallengesUnsub) sentChallengesUnsub();
    invitesUnsub = null;
    sentChallengesUnsub = null;
    return;
  }
  try {
    userProfile = await ensureUserProfile(u);
  } catch (e) {
    alert(e.message);
    await signOut(auth);
    return;
  }
  meU.textContent = userProfile.username;
  meE.textContent = u.email;
  show(lobbyView);
  listenInvites();
  listenSentChallenges();
});
