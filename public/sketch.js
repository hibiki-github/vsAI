// ゲーム状態管理
let currentScreen = 'title';
let targetLabel;
let gameTimer;
let timeLeft = 60;
let isGameActive = false;

// === socket.io初期化 ===
let socket = io();
let room = null;

// 部屋割り
socket.on('waiting', () => {
  console.log('もう一人の参加を待っています...');
});
socket.on('room_joined', (data) => {
  room = data.room;
  console.log('部屋に参加:', room);
});

let waitingDotsInterval = null;

function showWaitingMessage(show) {
  const msg = document.getElementById('waitingMessage');
  if (!msg) return;
  const waves = msg.querySelectorAll('.wave');
  if (!waves.length) return;
  for (const span of waves) {
    span.style.visibility = show ? 'visible' : 'hidden';
  }
}

// --- 再戦希望通知メッセージ制御 ---
function showOpponentRematchMsg(show, waiting) {
  const msg = document.getElementById('opponentRematchMsg');
  const text = document.getElementById('rematchMsgText');
  if (!msg || !text) return;
  msg.style.visibility = show ? 'visible' : 'hidden';
  if (show) {
    text.textContent = waiting ? '相手の選択を待っています' : '相手が再戦を希望しています';
  }
}

// === 部屋選択画面ロジック ===
function requestRoomStatus() {
  socket.emit('get_rooms');
}
socket.on('room_status', (status) => {
  const roomList = document.getElementById('roomList');
  if (!roomList) return;
  roomList.innerHTML = '';
  for (const roomName of ['room1', 'room2', 'room3', 'room4']) {
    const btn = document.createElement('button');
    btn.className = 'game-button room-btn';
    btn.textContent = `${roomName}　待機中: ${status[roomName]}人`;
    btn.disabled = status[roomName] >= 2;
    btn.onclick = () => joinRoom(roomName);
    roomList.appendChild(btn);
  }
  // 自分が入っている部屋が2人になったら待機中メッセージを消す
  if (room && status[room] === 2) {
    showWaitingMessage(false);
  }
});
function joinRoom(roomName) {
  myName = getUserName();
  myIcon = getUserIcon();
  socket.emit('join_room', { roomName, name: myName, icon: myIcon });
  requestRoomStatus();
  showWaitingMessage(true);
}

// シーン遷移関数
function showScreen(screenId) {
  // 全ての画面を非表示
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none'; // 明示的に非表示
  });

  // 指定された画面を表示
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    target.style.display = 'flex'; // 明示的に表示
    console.log('表示中の画面:', screenId, target);
    // ゲーム画面に遷移したときはmatchingEffect帯を必ず非表示に
    if (screenId === 'gameScreen') {
      const effect = document.getElementById('matchingEffect');
      if (effect) {
        effect.style.display = 'none';
        effect.style.opacity = 0;
      }
    }
  } else {
    console.error('画面が見つかりません:', screenId);
  }
}

// お題をランダムに選択
function pickRandomCategory() {
  return categories[Math.floor(Math.random() * categories.length)];
}

let rematchRequested = false;

// 帯のフェードイン・フェードアウトを安定制御
function showMatchingEffect(text) {
  const effect = document.getElementById('matchingEffect');
  if (!effect) return;
  effect.innerHTML = text;
  effect.style.display = '';
  // すぐopacity=0にしてから、次フレームで1にすることでトランジションを確実に発火
  effect.style.opacity = 0;
  setTimeout(() => {
    effect.style.opacity = 1;
  }, 20);
}

function hideMatchingEffect() {
  const effect = document.getElementById('matchingEffect');
  if (!effect) return;
  effect.style.opacity = 0;
  // トランジション終了後にdisplay:none
  setTimeout(() => {
    effect.style.display = 'none';
  }, 800); // CSSのtransitionと合わせる
}

// サーバーからお題を受信したときだけセット＆ゲーム開始
socket.on('receive_topic', (topic) => {
  const effect = document.getElementById('matchingEffect');
  if (effect) {
    timeLeft = 30;
    updateTimerDisplay();
    showMatchingEffect('マッチング成立！');
    setTimeout(() => {
      showMatchingEffect(`お題：<span style=\"color:#ffe066;\">${topic}</span>`);
      setTimeout(() => {
        showMatchingEffect('<span style=\"letter-spacing:0.1em;\">ready?</span>');
        setTimeout(() => {
          showMatchingEffect('<span style=\"letter-spacing:0.1em;\">GO!</span>');
          setTimeout(() => {
            hideMatchingEffect();
            setTopic(topic);
            startTimer();
            startGame();
          }, 2500);
        }, 2500);
      }, 3500);
    }, 2500);
  } else {
    setTopic(topic);
    startTimer();
    startGame();
  }
});

// room_ready受信時、2秒間マッチング演出を表示し、その後ゲーム開始処理（ホスト判定・お題決定）を行うように修正。
socket.on('room_ready', (data) => {
  showScreen('gameScreen');
  room = data.room;
  showWaitingMessage(false);
  showOpponentRematchMsg(false, false);
  timeLeft = 30;
  // matchingEffectの表示はここでは一切しない（念のため非表示に）
  const effect = document.getElementById('matchingEffect');
  if (effect) {
    effect.style.display = 'none';
    effect.style.opacity = 0;
  }
  // ユーザー名・アイコン情報があれば反映
  if (data.names && data.icons) {
    myName = data.names[socket.id] || myName;
    myIcon = data.icons[socket.id] || myIcon;
    const opponentEntry = Object.entries(data.names).find(([id, n]) => id !== socket.id);
    if (opponentEntry) {
      opponentName = opponentEntry[1];
      opponentIcon = data.icons[opponentEntry[0]] || '👤';
    }
    setPlayerTitles();
  }
  if (data.hostId === socket.id) {
    const topic = pickRandomCategory();
    console.log('ホストとしてお題を決定:', topic);
    socket.emit('send_topic', { room, topic });
  }
});

// setTopicはお題を画面に表示し、targetLabelにセット
function setTopic(topic) {
  targetLabel = topic;
  const el = document.getElementById('targetCategory');
  if (el) {
    el.innerText = `お題：${topic}`;
    console.log('setTopicでお題を表示:', topic);
  } else {
    console.error('setTopic: targetCategoryが見つからない');
  }
}

// ゲーム画面遷移時にもタイトルを更新
function startGame() {
  timeLeft = 30;
  showScreen('gameScreen');
  const effect = document.getElementById('matchingEffect');
  if (effect) {
    effect.style.display = 'none';
    effect.style.opacity = 0;
  }
  setPlayerTitles();
  finished = false;
  const judgeBtn = document.getElementById('judgeBtn');
  if (judgeBtn) judgeBtn.disabled = false;
  if (window.clearCanvas1) window.clearCanvas1();
  if (window.clearCanvas2) window.clearCanvas2();
}

// タイマー機能
function startTimer() {
  clearInterval(gameTimer); // 既存のタイマーを必ず止める
  timeLeft = 30; // 30秒に変更
  isGameActive = true;
  updateTimerDisplay();

  gameTimer = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();

    if (timeLeft <= 0) {
      clearInterval(gameTimer);
      isGameActive = false;
      judgeGame();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timerText = document.getElementById('timerText');
  const timerProgress = document.getElementById('timerProgress');
  
  timerText.innerText = `制限時間: ${timeLeft}秒`;
  const progressPercent = (timeLeft / 30) * 100; // 30秒基準に修正
  timerProgress.style.width = `${progressPercent}%`;
  
  // 残り時間が少なくなったら色を変更
  if (timeLeft <= 10) {
    timerProgress.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
  } else if (timeLeft <= 15) {
    timerProgress.style.background = 'linear-gradient(90deg, #ffc107, #e0a800)';
  } else {
    timerProgress.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
  }
}

function stopTimer() {
  clearInterval(gameTimer);
  isGameActive = false;
}

// お題に対する予測度合いを計算する関数
function calculateTargetScore(results, targetLabel) {
  let targetScore = 0;

  // 結果の中からお題に一致するものを探す
  for (let i = 0; i < results.length; i++) {
    if (results[i] && results[i].label === targetLabel) {
      targetScore = results[i].confidence;
      break;
    }
  }

  return targetScore;
}

// ゲーム判定
function judgeGame() {
  finished = false;
  stopTimer();
  
  const user1Results = window.getUser1Results();
  const user2Results = window.getUser2Results();
  
  if (!user1Results || !user2Results) {
    // document.getElementById('winnerDisplay').innerText = "判定するには両方のプレイヤーが描画してください";
    return;
  }

  const user1Score = calculateTargetScore(user1Results, targetLabel);
  const user2Score = calculateTargetScore(user2Results, targetLabel);

  let result = "";
  let winner = "";
  
  if (user1Score === 0 && user2Score === 0) {
    result = "どちらもお題を認識できませんでした！";
    winner = "引き分け";
  } else if (user1Score === user2Score) {
    result = "引き分け！";
    winner = "引き分け";
  } else if (user1Score > user2Score) {
    result = "プレイヤー1の勝ち！";
    winner = "プレイヤー1";
  } else {
    result = "プレイヤー2の勝ち！";
    winner = "プレイヤー2";
  }
  
  // 詳細なスコア情報を追加
  const user1ScorePercent = (user1Score * 100).toFixed(2);
  const user2ScorePercent = (user2Score * 100).toFixed(2);
  
  result += ` (プレイヤー1: ${user1ScorePercent}%, プレイヤー2: ${user2ScorePercent}%)`;

  // document.getElementById('winnerDisplay').innerText = result;
  
  // 結果画面に詳細を表示
  showResultScreen(winner, user1ScorePercent, user2ScorePercent, targetLabel);
}

// 結果画面を表示
function showResultScreen(winner, player1Score, player2Score, target) {
  finished = false;
  const judgeBtn = document.getElementById('judgeBtn');
  if (judgeBtn) judgeBtn.disabled = false;
  rematchRequested = false; // 結果画面遷移時にもリセット
  showOpponentRematchMsg(false, false); // 結果画面遷移時に必ず非表示
  const finalResult = document.getElementById('finalResult');
  const player1Result = document.getElementById('player1Result');
  const player2Result = document.getElementById('player2Result');
  const resultTopic = document.getElementById('resultTopic');
  const player1Image = document.getElementById('player1Image');
  const player2Image = document.getElementById('player2Image');
  
  if (winner === "引き分け") {
    finalResult.innerHTML = "🤝 引き分け！";
  } else {
    finalResult.innerHTML = `${winner}の勝利！`;
  }
  
  // お題を一つだけ表示
  resultTopic.innerHTML = `<span>お題：${target}</span>`;

  // トロフィー表示の制御
  let p1Trophy = "", p2Trophy = "";
  if (winner === "プレイヤー1") p1Trophy = " 🏆";
  if (winner === "プレイヤー2") p2Trophy = " 🏆";

  // 既存のh3, pを削除
  player1Result.querySelectorAll('h3, p').forEach(e => e.remove());
  player2Result.querySelectorAll('h3, p').forEach(e => e.remove());

  // プレイヤー1のh3, pをimgの前後に挿入
  const h3_1 = document.createElement('h3');
  h3_1.innerHTML = `${myIcon} ${myName}${p1Trophy}`;
  const p1 = document.createElement('p');
  p1.textContent = `スコア: ${player1Score}%`;
  player1Result.insertBefore(h3_1, player1Image);
  player1Result.insertBefore(p1, player1Image.nextSibling);

  // プレイヤー2のh3, pをimgの前後に挿入
  const h3_2 = document.createElement('h3');
  h3_2.innerHTML = `${opponentIcon} ${opponentName}${p2Trophy}`;
  const p2 = document.createElement('p');
  p2.textContent = `スコア: ${player2Score}%`;
  player2Result.insertBefore(h3_2, player2Image);
  player2Result.insertBefore(p2, player2Image.nextSibling);

  // プレイヤー1の絵を表示
  if (window.getUser1Canvas) {
    const dataUrl1 = window.getUser1Canvas();
    if (dataUrl1) {
      player1Image.src = dataUrl1;
      player1Image.style.display = "block";
    } else {
      player1Image.style.display = "none";
    }
  }
  // プレイヤー2の絵を表示
  if (window.getUser2Canvas) {
    const dataUrl2 = window.getUser2Canvas();
    if (dataUrl2) {
      player2Image.src = dataUrl2;
      player2Image.style.display = "block";
    } else {
      player2Image.style.display = "none";
    }
  }

  showScreen('resultScreen');
}

// ゲーム状態リセット関数
function resetGameState() {
  stopTimer(); // タイマー停止
  isGameActive = false;
  finished = false;
  const judgeBtn = document.getElementById('judgeBtn');
  if (judgeBtn) judgeBtn.disabled = false;
  // 必要なら他のグローバル変数もリセット
  // timeLeft = 60;
  // 予測結果や勝者表示もリセットしたい場合はここで
  // document.getElementById('winnerDisplay').innerText = "勝者：？";
}

// イベントリスナーの設定
function setupEventListeners() {
  console.log('イベントリスナーを設定中...'); // デバッグログ

  // タイトル画面のボタン
  const startGameBtn = document.getElementById('startGameBtn');
  if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
      showScreen('roomSelectScreen');
      requestRoomStatus();
    });
  } else {
    console.error('startGameBtnが見つかりません'); // エラーログ
  }

  const howToPlayBtn = document.getElementById('howToPlayBtn');
  if (howToPlayBtn) {
    howToPlayBtn.addEventListener('click', () => {
      showScreen('howToPlayScreen');
    });
  }

  // 遊び方画面のボタン
  const backToTitleBtn = document.getElementById('backToTitleBtn');
  if (backToTitleBtn) {
    backToTitleBtn.addEventListener('click', () => {
      showScreen('titleScreen');
    });
  }

  // ゲーム画面のボタン
  const resetTargetBtn = document.getElementById('resetTargetBtn');
  if (resetTargetBtn) {
    resetTargetBtn.addEventListener('click', () => {
      pickRandomCategory();
      // タイマーをリセット
      stopTimer();
      startTimer();
    });
  }

  const backToTitleFromGameBtn = document.getElementById('backToTitleFromGameBtn');
  if (backToTitleFromGameBtn) {
    backToTitleFromGameBtn.addEventListener('click', () => {
      resetGameState();
      showScreen('titleScreen');
    });
  }

  const judgeBtn = document.getElementById('judgeBtn');
  if (judgeBtn) {
    judgeBtn.addEventListener('click', () => {
      console.log('完成ボタン押下: finished=', finished, 'room=', room);
      if (finished) return;
      finished = true;
      judgeBtn.disabled = true;
      showOpponentFinishMsg(true, true); // 「相手の完成を待っています」
      if (room) {
        socket.emit('finish_request', room);
      } else {
        judgeGame(); // シングルプレイ等
      }
    });
  }

  // 結果画面のボタン
  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      if (room && !rematchRequested) {
        // すでに「相手が再戦を希望しています」が表示されている場合は上書きしない
        const msg = document.getElementById('opponentRematchMsg');
        const text = document.getElementById('rematchMsgText');
        if (msg && text && text.textContent === '相手が再戦を希望しています' && msg.style.visibility === 'visible') {
          // 何もしない（上書きせずサーバーに送信のみ）
        } else {
          showOpponentRematchMsg(true, true); // 通常通り「相手の選択を待っています」
        }
        socket.emit('rematch_request', room);
        showWaitingMessage(true); // 再戦待ち中も表示
        rematchRequested = true;
      }
    });
  }

  // --- サーバーからのrematch_noticeを受信したら表示 ---
  socket.on('rematch_notice', () => {
    // すでに「相手の選択を待っています」が表示されている場合は上書きしない
    const msg = document.getElementById('opponentRematchMsg');
    const text = document.getElementById('rematchMsgText');
    if (msg && text && text.textContent === '相手の選択を待っています' && msg.style.visibility === 'visible') {
      // 何もしない（上書きせずそのまま）
    } else {
      showOpponentRematchMsg(true, false); // 通常通り「相手が再戦を希望しています」
    }
  });

  // --- room_readyやタイトル戻り時は非表示 ---
  socket.on('room_ready', (data) => {
    showScreen('gameScreen');
    room = data.room;
    showWaitingMessage(false);
    showOpponentRematchMsg(false, false);
    startGame();
  });

  const backToTitleFromResultBtn = document.getElementById('backToTitleFromResultBtn');
  if (backToTitleFromResultBtn) {
    backToTitleFromResultBtn.addEventListener('click', () => {
      resetGameState();
      showScreen('titleScreen');
      showOpponentRematchMsg(false, false);
    });
  }

  const backToTitleFromRoomSelect = document.getElementById('backToTitleFromRoomSelect');
  if (backToTitleFromRoomSelect) {
    backToTitleFromRoomSelect.addEventListener('click', () => {
      showScreen('titleScreen');
    });
  }

  // サーバーから相手の完成通知
  socket.on('finish_notice', () => {
    // すでに「相手の完成を待っています」が表示されている場合は上書きしない
    const msg = document.getElementById('opponentFinishMsg');
    const text = document.getElementById('finishMsgText');
    if (msg && text && text.textContent === '相手の完成を待っています' && msg.style.visibility === 'visible') {
      // 何もしない
    } else {
      showOpponentFinishMsg(true, false); // 「相手が完成ボタンを押しました！」
    }
  });

  // サーバーから両者完成通知
  socket.on('result_ready', () => {
    judgeGame();
    showOpponentFinishMsg(false, false);
    if (judgeBtn) judgeBtn.disabled = false;
    finished = false;
  });

  console.log('イベントリスナーの設定完了'); // デバッグログ
}

// DOMContentLoadedイベントでイベントリスナーを設定
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoadedイベントが発火しました'); // デバッグログ
  setupEventListeners();
});

// フォールバックとしてloadイベントでも設定
window.addEventListener('load', () => {
  console.log('loadイベントが発火しました'); // デバッグログ
  setupEventListeners();
});

// 左のキャンバス
new p5(p => {
  let classifier, canvas;
  let labelSpans = [], confidenceSpans = [];
  let currentResults = []; // 現在の結果を保存
  let isEraser = false;
  let penColor = 0;
  let penWeight = 16;

  p.preload = () => {
    classifier = ml5.imageClassifier('DoodleNet');
  };

  p.setup = () => {
    canvas = p.createCanvas(400, 400);
    canvas.parent('canvasContainer1');
    p.background(255);

    // スマホでのスワイプ・スクロール防止
    canvas.elt.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.elt.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    canvas.elt.addEventListener('touchend', e => e.preventDefault(), { passive: false });

    for (let i = 1; i <= 3; i++) {
      labelSpans.push(p.select(`#label1_${i}`));
      confidenceSpans.push(p.select(`#confidence1_${i}`));
    }

    p.select("#clearBtn1").mousePressed(() => {
      p.background(255);
      for (let i = 0; i < 3; i++) {
        labelSpans[i].html('');
        confidenceSpans[i].html('');
      }
      // 相手にも消去を通知
      if (room) socket.emit('draw', { room, type: 'clear' });
    });

    // 消しゴム・ペン切り替え
    p.select("#eraserBtn1").mousePressed(() => {
      isEraser = true;
      penColor = 255;
      penWeight = 32;
      document.getElementById('eraserBtn1').style.display = 'none';
      document.getElementById('penBtn1').style.display = 'inline-block';
    });
    p.select("#penBtn1").mousePressed(() => {
      isEraser = false;
      penColor = 0;
      penWeight = 16;
      document.getElementById('eraserBtn1').style.display = 'inline-block';
      document.getElementById('penBtn1').style.display = 'none';
    });

    classifier.classify(canvas.elt, gotResult);
  };

  p.draw = () => {
    if (!isGameActive) return;
    p.strokeWeight(penWeight);
    p.stroke(penColor);
    if (p.mouseIsPressed) {
      p.line(p.pmouseX, p.pmouseY, p.mouseX, p.mouseY);
      // 自分の描画データを送信
      if (room) {
        socket.emit('draw', {
          room,
          type: 'line',
          x1: p.pmouseX, y1: p.pmouseY, x2: p.mouseX, y2: p.mouseY,
          color: penColor, weight: penWeight
        });
      }
    }
  };

  function gotResult(error, results) {
    if (error) return console.error(error);
    currentResults = results; // 結果を保存

    for (let i = 0; i < 3; i++) {
      if (results[i]) {
        labelSpans[i].html(results[i].label);
        confidenceSpans[i].html(p.floor(results[i].confidence * 100) + "%");
      }
    }
    classifier.classify(canvas.elt, gotResult);
  }

  // グローバルからアクセスできるように結果を公開
  window.getUser1Results = () => currentResults;
  window.clearCanvas1 = () => p.background(255);
  window.getUser1Canvas = () => {
    if (canvas) {
      return canvas.elt.toDataURL();
    }
    return null;
  };
});

// 右のキャンバス
new p5(p => {
  let classifier, canvas;
  let labelSpans = [], confidenceSpans = [];
  let currentResults = []; // 現在の結果を保存

  p.preload = () => {
    classifier = ml5.imageClassifier('DoodleNet');
  };

  p.setup = () => {
    canvas = p.createCanvas(400, 400);
    canvas.parent('canvasContainer2');
    p.background(255);

    for (let i = 1; i <= 3; i++) {
      labelSpans.push(p.select(`#label2_${i}`));
      confidenceSpans.push(p.select(`#confidence2_${i}`));
    }

    // 右側は自分で描画できないので、ボタンを無効化
    ["clearBtn2", "eraserBtn2", "penBtn2"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = true;
    });

    classifier.classify(canvas.elt, gotResult);
  };

  // 右側は自分で描画しない
  p.draw = () => {
    // 何もしない
  };

  // 相手の描画データを受信して反映
  socket.on('draw', (data) => {
    if (!room || data.room !== room) return;
    if (data.type === 'clear') {
      p.background(255);
      for (let i = 0; i < 3; i++) {
        labelSpans[i].html('');
        confidenceSpans[i].html('');
      }
      return;
    }
    if (data.type === 'line') {
      p.strokeWeight(data.weight);
      p.stroke(data.color);
      p.line(data.x1, data.y1, data.x2, data.y2);
    }
  });

  function gotResult(error, results) {
    if (error) return console.error(error);
    currentResults = results; // 結果を保存

    for (let i = 0; i < 3; i++) {
      if (results[i]) {
        labelSpans[i].html(results[i].label);
        confidenceSpans[i].html(p.floor(results[i].confidence * 100) + "%");
      }
    }
    classifier.classify(canvas.elt, gotResult);
  }

  // グローバルからアクセスできるように結果を公開
  window.getUser2Results = () => currentResults;
  window.clearCanvas2 = () => p.background(255);
  window.getUser2Canvas = () => {
    if (canvas) {
      return canvas.elt.toDataURL();
    }
    return null;
  };
});

// --- 完成同期用メッセージ制御 ---
function showOpponentFinishMsg(show, waiting) {
  let msg = document.getElementById('opponentFinishMsg');
  let text = document.getElementById('finishMsgText');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'opponentFinishMsg';
    msg.className = 'rematch-message';
    text = document.createElement('span');
    text.id = 'finishMsgText';
    msg.appendChild(text);
    // ゲーム画面の中央に追加
    const judgeSection = document.querySelector('.judge-inner');
    if (judgeSection) judgeSection.appendChild(msg);
  }
  if (!text) return;
  msg.style.visibility = show ? 'visible' : 'hidden';
  if (show) {
    text.textContent = waiting ? '相手はまだ！' : '相手が完成！';
  }
}

// === ユーザー名・アイコン管理 ===
let myName = '';
let opponentName = '';
let myIcon = '👤';
let opponentIcon = '👤';

// ユーザー名・アイコン入力欄の値を取得
function getUserName() {
  const input = document.getElementById('usernameInput');
  if (input) {
    return input.value.trim() || '名無し';
  }
  return '名無し';
}
function getUserIcon() {
  const sel = document.getElementById('iconSelect');
  if (sel) return sel.value;
  return '👤';
}

function setPlayerTitles() {
  const p1 = document.getElementById('player1Title');
  const p2 = document.getElementById('player2Title');
  if (p1) p1.innerText = `${myIcon} ${myName}`;
  if (p2) p2.innerText = `${opponentIcon} ${opponentName || '???'}`;
}
