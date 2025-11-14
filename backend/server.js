import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_URL = "https://nvl-1.onrender.com";

const app = express();
const PORT = process.env.PORT;
const DB_PATH = path.join(__dirname, 'db.json');


app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port', PORT);
});

// --- Утилиты работы с "базой" --------------------

async function readDb() {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeDb(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Настройки сервера ---------------------------

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Middleware для получения текущего пользователя по заголовку
async function authMiddleware(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId) {
    return res.status(401).json({ error: 'No user id' });
  }
  const db = await readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.db = db;
  req.user = user;
  next();
}

// --- Auth ----------------------------------------

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  const db = await readDb();
  if (db.users.some(u => u.username === username)) {
    return res.status(400).json({ error: 'Имя уже занято' });
  }

  const user = {
    id: Date.now().toString(),
    username,
    password, // В реале: хэшировать!
    avatar: username.charAt(0).toUpperCase(),
    avatarImage: null,
    bio: ''
  };

  db.users.push(user);
  db.friends.push({ userId: user.id, friends: [] });
  db.friendRequests.push({ userId: user.id, sent: [], received: [] });
  db.messages[user.id] = {}; // можно не использовать, оставим для совместимости

  await writeDb(db);
  res.json({ user: { ...user, password: undefined } });
});

// Логин
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await readDb();
  const user = db.users.find(
    u => u.username === username && u.password === password
  );
  if (!user) return res.status(400).json({ error: 'Неверные данные' });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarImage: user.avatarImage
    }
  });
});

// --- Пользователь --------------------------------

app.get('/api/me', authMiddleware, async (req, res) => {
  const { user } = req;
  res.json({
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    avatarImage: user.avatarImage
  });
});

// Обновить аватар (base64-строка)
app.post('/api/me/avatar', authMiddleware, async (req, res) => {
  const { avatarImage } = req.body;
  if (!avatarImage) return res.status(400).json({ error: 'Нет изображения' });

  const db = req.db;
  const userIndex = db.users.findIndex(u => u.id === req.user.id);
  db.users[userIndex].avatarImage = avatarImage;

  await writeDb(db);
  res.json({ success: true, avatarImage });
});

// --- Посты ---------------------------------------

app.get('/api/posts', authMiddleware, async (req, res) => {
  const db = req.db;
  const posts = db.posts
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(posts);
});

app.post('/api/posts', authMiddleware, async (req, res) => {
  const { text, image } = req.body;
  if (!text && !image)
    return res.status(400).json({ error: 'Пустой пост' });

  const db = req.db;
  const post = {
    id: Date.now().toString(),
    authorId: req.user.id,
    author: req.user.username,
    authorAvatar: req.user.avatar,
    authorAvatarImage: req.user.avatarImage,
    text: text || '',
    image: image || null,
    createdAt: Date.now(),
    likes: [],
    comments: []
  };
  db.posts.push(post);
  await writeDb(db);
  res.json(post);
});

// Лайк/анлайк
app.post('/api/posts/:postId/like', authMiddleware, async (req, res) => {
  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const idx = post.likes.indexOf(req.user.id);
  if (idx === -1) post.likes.push(req.user.id);
  else post.likes.splice(idx, 1);

  await writeDb(db);
  res.json({ likes: post.likes });
});

// Комментарий
app.post('/api/posts/:postId/comment', authMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пустой комментарий' });

  const db = req.db;
  const post = db.posts.find(p => p.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const comment = {
    id: Date.now().toString(),
    authorId: req.user.id,
    author: req.user.username,
    authorAvatar: req.user.avatar,
    authorAvatarImage: req.user.avatarImage,
    text,
    time: new Date().toISOString()
  };

  post.comments.push(comment);
  await writeDb(db);
  res.json(comment);
});

// --- Друзья и заявки -----------------------------

// Получить список друзей
app.get('/api/friends', authMiddleware, async (req, res) => {
  const db = req.db;
  const friendsEntry =
    db.friends.find(f => f.userId === req.user.id) || { friends: [] };

  const friendUsers = friendsEntry.friends
    .map(fid => db.users.find(u => u.id === fid))
    .filter(Boolean)
    .map(u => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      avatarImage: u.avatarImage
    }));

  res.json(friendUsers);
});

// Получить заявки
app.get('/api/friend-requests', authMiddleware, async (req, res) => {
  const db = req.db;
  const fr =
    db.friendRequests.find(fr => fr.userId === req.user.id) || {
      sent: [],
      received: []
    };

  res.json(fr);
});

// Отправить заявку
app.post('/api/friend-requests', authMiddleware, async (req, res) => {
  const { toUserId } = req.body;
  const db = req.db;

  if (toUserId === req.user.id)
    return res.status(400).json({ error: 'Нельзя добавить себя' });

  const target = db.users.find(u => u.id === toUserId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  function getFR(userId) {
    let entry = db.friendRequests.find(fr => fr.userId === userId);
    if (!entry) {
      entry = { userId, sent: [], received: [] };
      db.friendRequests.push(entry);
    }
    return entry;
  }

  const meFR = getFR(req.user.id);
  const targetFR = getFR(toUserId);

  if (!meFR.sent.includes(toUserId)) meFR.sent.push(toUserId);
  if (!targetFR.received.includes(req.user.id))
    targetFR.received.push(req.user.id);

  await writeDb(db);
  res.json({ success: true });
});

// Принять заявку
app.post('/api/friend-requests/:fromUserId/accept', authMiddleware, async (req, res) => {
  const fromUserId = req.params.fromUserId;
  const db = req.db;

  function getFR(userId) {
    let entry = db.friendRequests.find(fr => fr.userId === userId);
    if (!entry) {
      entry = { userId, sent: [], received: [] };
      db.friendRequests.push(entry);
    }
    return entry;
  }

  function getFriends(userId) {
    let entry = db.friends.find(f => f.userId === userId);
    if (!entry) {
      entry = { userId, friends: [] };
      db.friends.push(entry);
    }
    return entry;
  }

  const meFR = getFR(req.user.id);
  const fromFR = getFR(fromUserId);

  meFR.received = meFR.received.filter(id => id !== fromUserId);
  fromFR.sent = fromFR.sent.filter(id => id !== req.user.id);

  const meFriends = getFriends(req.user.id);
  const fromFriends = getFriends(fromUserId);

  if (!meFriends.friends.includes(fromUserId))
    meFriends.friends.push(fromUserId);
  if (!fromFriends.friends.includes(req.user.id))
    fromFriends.friends.push(req.user.id);

  await writeDb(db);
  res.json({ success: true });
});

// Отклонить заявку
app.post('/api/friend-requests/:fromUserId/decline', authMiddleware, async (req, res) => {
  const fromUserId = req.params.fromUserId;
  const db = req.db;

  function getFR(userId) {
    let entry = db.friendRequests.find(fr => fr.userId === userId);
    if (!entry) {
      entry = { userId, sent: [], received: [] };
      db.friendRequests.push(entry);
    }
    return entry;
  }

  const meFR = getFR(req.user.id);
  const fromFR = getFR(fromUserId);

  meFR.received = meFR.received.filter(id => id !== fromUserId);
  fromFR.sent = fromFR.sent.filter(id => id !== req.user.id);

  await writeDb(db);
  res.json({ success: true });
});

// --- Сообщения -----------------------------------

// Получить список чатов с друзьями + послед. сообщение
app.get('/api/chats', authMiddleware, async (req, res) => {
  const db = req.db;
  const friendsEntry =
    db.friends.find(f => f.userId === req.user.id) || { friends: [] };

  const chats = friendsEntry.friends.map(friendId => {
    const friend = db.users.find(u => u.id === friendId);
    if (!friend) return null;

    const chatId = [req.user.id, friendId].sort().join('_');
    const chatMessages = db.messages[chatId] || [];
    const lastMessage =
      chatMessages.length > 0
        ? chatMessages[chatMessages.length - 1]
        : null;

    return {
      friend: {
        id: friend.id,
        username: friend.username,
        avatar: friend.avatar,
        avatarImage: friend.avatarImage
      },
      lastMessage
    };
  }).filter(Boolean);

  res.json(chats);
});

// Сообщения с конкретным другом
app.get('/api/chats/:friendId', authMiddleware, async (req, res) => {
  const friendId = req.params.friendId;
  const db = req.db;
  const chatId = [req.user.id, friendId].sort().join('_');
  const chatMessages = db.messages[chatId] || [];
  res.json(chatMessages);
});

// Текстовое сообщение
app.post('/api/chats/:friendId/message', authMiddleware, async (req, res) => {
  const friendId = req.params.friendId;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

  const db = req.db;
  const chatId = [req.user.id, friendId].sort().join('_');
  if (!db.messages[chatId]) db.messages[chatId] = [];

  const msg = {
    id: Date.now().toString(),
    senderId: req.user.id,
    text,
    type: 'text',
    time: new Date().toISOString(),
    read: false
  };

  db.messages[chatId].push(msg);
  await writeDb(db);
  res.json(msg);
});

// Голосовое сообщение (base64)
app.post('/api/chats/:friendId/voice', authMiddleware, async (req, res) => {
  const friendId = req.params.friendId;
  const { audioData } = req.body;

  if (!audioData) return res.status(400).json({ error: 'Нет аудио' });

  const db = req.db;
  const chatId = [req.user.id, friendId].sort().join('_');
  if (!db.messages[chatId]) db.messages[chatId] = [];

  const msg = {
    id: Date.now().toString(),
    senderId: req.user.id,
    type: 'voice',
    audioData,
    time: new Date().toISOString(),
    read: false
  };

  db.messages[chatId].push(msg);
  await writeDb(db);
  res.json(msg);
});

// --- Запуск --------------------------------------

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});


// Инициализация базы при первом запуске
async function initDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    const initialData = {
      users: [],
      posts: [],
      friends: [],
      friendRequests: [],
      messages: {}
    };
    await writeDb(initialData);
    console.log('Initialized new database at', DB_PATH);
  }
}
initDb();

