// ==UserScript==
// @name         B站自动评论管理助手
// @namespace    https://github.com/user/bilibili-comment-manager
// @version      1.0.0
// @description  B站评论管理工具 - 评论抓取、素材库管理、定时发送配置、运行状态监控
// @author       YourName
// @match        *://*.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      api.bilibili.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  class CommentStorage {
    constructor() {
      this.storageKey = 'bcm_comment_data';
      this.data = this.loadData();
    }

    loadData() {
      const defaultData = {
        version: '1.0',
        lastUpdated: Date.now(),
        settings: {
          maxCapacity: 200,
          targetVideoUrl: '',
          targetOid: '',
          sortType: 'hot',
          obfuscationSettings: {
            zeroWidthChars: true,
            randomSpaces: true,
            emojiDecoration: true,
            homophoneReplace: false
          }
        },
        antiBanSettings: {
          minInterval: 30,
          maxInterval: 120,
          dailyLimit: 50,
          activeHours: { start: 9, end: 23 },
          errorCooldown: 300,
          maxConsecutiveErrors: 5
        },
        comments: [],
        usageStats: {
          todaySent: 0,
          totalSent: 0,
          lastSentTime: null,
          lastResetDate: new Date().toISOString().slice(0, 10),
          errorCount: 0,
          consecutiveErrors: 0
        },
        logs: []
      };

      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return defaultData;
        const parsed = JSON.parse(raw);
        if (!parsed.version || !parsed.comments) return defaultData;
        this.checkAndResetDailyStats(parsed);
        return parsed;
      } catch (e) {
        console.error('Bilimili评论管理器: 数据加载失败，使用默认数据', e);
        return defaultData;
      }
    }

    saveData() {
      this.data.lastUpdated = Date.now();
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.error('Bilimili评论管理器: 数据保存失败', e);
        return false;
      }
    }

    checkAndResetDailyStats(parsed) {
      const today = new Date().toISOString().slice(0, 10);
      if (parsed.usageStats.lastResetDate !== today) {
        parsed.usageStats.todaySent = 0;
        parsed.usageStats.lastResetDate = today;
      }
    }

    addComment(rawComment) {
      const comment = {
        id: generateId(),
        content: rawComment.content || rawComment.message || '',
        author: rawComment.author || rawComment.uname || '',
        likeCount: rawComment.likeCount || rawComment.like || 0,
        fetchTime: Date.now(),
        isUsed: false,
        useCount: 0,
        lastUsedTime: null,
        hash: hashString(rawComment.content || rawComment.message || '')
      };

      if (!comment.content) return null;

      this.data.comments.push(comment);
      this.enforceCapacity();
      this.saveData();
      return comment;
    }

    addComments(comments) {
      let added = 0;
      for (const c of comments) {
        if (this.addComment(c)) added++;
      }
      return added;
    }

    enforceCapacity() {
      const max = this.data.settings.maxCapacity;
      if (this.data.comments.length <= max) return;

      const unused = this.data.comments.filter(c => !c.isUsed);
      const used = this.data.comments.filter(c => c.isUsed);

      while (this.data.comments.length > max && used.length > 0) {
        used.shift();
      }

      this.data.comments = [...unused, ...used];

      while (this.data.comments.length > max) {
        this.data.comments.shift();
      }

      this.saveData();
    }

    getComments(filter = 'all') {
      if (filter === 'unused') return this.data.comments.filter(c => !c.isUsed);
      if (filter === 'used') return this.data.comments.filter(c => c.isUsed);
      return this.data.comments;
    }

    getUnusedCount() {
      return this.data.comments.filter(c => !c.isUsed).length;
    }

    getTotalCount() {
      return this.data.comments.length;
    }

    deleteComment(id) {
      this.data.comments = this.data.comments.filter(c => c.id !== id);
      this.saveData();
    }

    clearAll() {
      this.data.comments = [];
      this.saveData();
    }

    setCapacity(cap) {
      this.data.settings.maxCapacity = Math.max(10, Math.min(1000, cap));
      this.enforceCapacity();
      this.saveData();
    }

    markCommentUsed(id) {
      const comment = this.data.comments.find(c => c.id === id);
      if (comment) {
        comment.isUsed = true;
        comment.useCount++;
        comment.lastUsedTime = Date.now();
        this.saveData();
      }
    }

    resetAllComments() {
      for (const c of this.data.comments) {
        c.isUsed = false;
        c.useCount = 0;
        c.lastUsedTime = null;
      }
      this.saveData();
    }

    getConfig() {
      return this.data.settings;
    }

    setConfig(key, value) {
      this.data.settings[key] = value;
      this.saveData();
    }

    getAntiBanConfig() {
      return this.data.antiBanSettings;
    }

    setAntiBanConfig(key, value) {
      this.data.antiBanSettings[key] = value;
      this.saveData();
    }

    getUsageStats() {
      this.checkAndResetDailyStats(this.data);
      return this.data.usageStats;
    }

    incrementSent() {
      this.data.usageStats.todaySent++;
      this.data.usageStats.totalSent++;
      this.data.usageStats.lastSentTime = Date.now();
      this.data.usageStats.consecutiveErrors = 0;
      this.saveData();
    }

    incrementError() {
      this.data.usageStats.errorCount++;
      this.data.usageStats.consecutiveErrors++;
      this.saveData();
    }

    resetConsecutiveErrors() {
      this.data.usageStats.consecutiveErrors = 0;
      this.saveData();
    }

    getObfuscationSettings() {
      return this.data.settings.obfuscationSettings;
    }

    setObfuscationSettings(settings) {
      this.data.settings.obfuscationSettings = { ...this.data.settings.obfuscationSettings, ...settings };
      this.saveData();
    }

    addLog(type, content, detail = '') {
      const log = {
        timestamp: Date.now(),
        type,
        content,
        detail
      };
      this.data.logs.unshift(log);
      if (this.data.logs.length > 100) {
        this.data.logs = this.data.logs.slice(0, 100);
      }
      this.saveData();
    }

    getLogs() {
      return this.data.logs;
    }

    clearLogs() {
      this.data.logs = [];
      this.saveData();
    }
  }

  class CommentObfuscator {
    constructor() {
      this.zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
      this.emojiPool = ['✨', '🌟', '💫', '⭐', '🎉', '🎊', '💯', '👍', '👏', '🙌', '😊', '😄', '🥰', '💕', '❤️'];
      this.specialChars = ['·', '•', '○', '●', '◇', '◆', '☆', '★', '♪', '♫'];
      this.homophoneMap = {
        '的': ['滴', '徳'], '了': ['啦', '咯'], '是': ['系', '事'],
        '在': ['再', '载'], '我': ['沃', '莪'], '你': ['伱', '祢'],
        '他': ['她', '它'], '们': ['门', '闷'], '有': ['又', '友'],
        '这': ['者', '浙'], '那': ['哪', '呐'], '很': ['狠', '亨'],
        '都': ['豆', '斗'], '会': ['汇', '惠'], '到': ['道', '倒'],
        '说': ['讲', '诉'], '好': ['号', ' Hao'], '看': ['看见', '瞅'],
        '想': ['响', '向'], '做': ['作', '坐'], '去': ['趣', '趋'],
        '来': ['莱', '徕'], '吧': ['巴', '芭'], '啊': ['阿', '呵'],
        '呢': ['呐', '尼'], '吗': ['嘛', '么'], '呀': ['丫', '压'],
        '哦': ['噢', '喔'], '哈': ['蛤', '嘻'], '嘿': ['黑', '嗨'],
        '哇': ['蛙', '挖'], '真': ['珍', '贞'], '太': ['泰', '态'],
        '最': ['罪', '醉'], '多': ['夺', '朵'], '少': ['绍', '哨'],
        '大': ['达', '打'], '小': ['晓', '孝'], '不': ['布', '步'],
        '可': ['渴', '克'], '能': ['嫩', '耐'], '要': ['耀', '药'],
        '会': ['汇', '慧'], '出': ['初', '除'], '过': ['果', '锅'],
        '着': ['找', '招'], '和': ['合', '河'], '与': ['于', '余'],
        '给': ['给', 'gei'], '让': ['嚷', '壤'], '被': ['备', '背'],
        '把': ['吧', '靶'], '从': ['丛', '匆'], '对': ['队', '兑'],
        '于': ['鱼', '娱'], '为': ['未', '位'], '因': ['音', '阴'],
        '以': ['已', '亿'], '得': ['德', '锝'], '之': ['知', '支'],
        '人': ['仁', '任'], '家': ['加', '佳'], '事': ['是', '示'],
        '物': ['务', '悟'], '什': ['深', '神'], '么': ['末', '麽'],
        '么': ['末', '麽'], '呢': ['呐', '尼'], '吧': ['巴', '芭'],
        '的': ['滴', '徳'], '了': ['啦', '咯'], '是': ['系', '事'],
      };
    }

    obfuscate(text, settings) {
      let result = text;
      if (settings.zeroWidthChars) {
        result = this.insertZeroWidthChars(result);
      }
      if (settings.randomSpaces) {
        result = this.insertRandomSpaces(result);
      }
      if (settings.emojiDecoration) {
        result = this.addEmojiDecoration(result);
      }
      if (settings.homophoneReplace) {
        result = this.replaceHomophones(result);
      }
      return result;
    }

    insertZeroWidthChars(text) {
      const chars = text.split('');
      const count = Math.floor(Math.random() * 5) + 1;
      for (let i = 0; i < count; i++) {
        const pos = Math.floor(Math.random() * (chars.length + 1));
        const zwChar = this.zeroWidthChars[Math.floor(Math.random() * this.zeroWidthChars.length)];
        chars.splice(pos, 0, zwChar);
      }
      return chars.join('');
    }

    insertRandomSpaces(text) {
      const isChinese = /[\u4e00-\u9fa5]/.test(text);
      const words = isChinese ? text.split('') : text.split(' ');
      if (isChinese) {
        let result = '';
        for (let i = 0; i < words.length; i++) {
          result += words[i];
          if (i < words.length - 1 && Math.random() < 0.3) {
            result += Math.random() < 0.5 ? ' ' : '\u3000';
          }
        }
        return result;
      } else {
        let result = '';
        for (let i = 0; i < words.length; i++) {
          result += words[i];
          if (i < words.length - 1 && Math.random() < 0.2) {
            result += ' ';
          }
        }
        return result;
      }
    }

    addEmojiDecoration(text) {
      const prefix = Math.random() < 0.5;
      const pool = [...this.emojiPool, ...this.specialChars];
      const count = Math.floor(Math.random() * 2) + 1;
      let decoration = '';
      for (let i = 0; i < count; i++) {
        decoration += pool[Math.floor(Math.random() * pool.length)];
      }
      if (prefix) {
        return decoration + text;
      } else {
        return text + decoration;
      }
    }

    replaceHomophones(text) {
      let result = '';
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (this.homophoneMap[char] && Math.random() < 0.15) {
          const replacements = this.homophoneMap[char];
          result += replacements[Math.floor(Math.random() * replacements.length)];
        } else {
          result += char;
        }
      }
      return result;
    }
  }

  class AntiBanManager {
    constructor(storage) {
      this.storage = storage;
      this.cooldownMultiplier = 1;
      this.lastSendTimes = [];
    }

    getDelay(baseDelay) {
      const config = this.storage.getAntiBanConfig();
      const jitter = baseDelay * (0.2 + Math.random() * 0.3);
      const delay = baseDelay + jitter * this.cooldownMultiplier;
      return Math.max(config.minInterval * 1000, Math.floor(delay));
    }

    getRandomWait() {
      return Math.floor(Math.random() * 10000);
    }

    isActiveHours() {
      const config = this.storage.getAntiBanConfig();
      const hour = new Date().getHours();
      return hour >= config.activeHours.start && hour < config.activeHours.end;
    }

    canSendToday() {
      const config = this.storage.getAntiBanConfig();
      const stats = this.storage.getUsageStats();
      return stats.todaySent < config.dailyLimit;
    }

    shouldCooldown() {
      const config = this.storage.getAntiBanConfig();
      const stats = this.storage.getUsageStats();
      return stats.consecutiveErrors >= config.maxConsecutiveErrors;
    }

    shouldIncreaseCooldown() {
      const config = this.storage.getAntiBanConfig();
      const stats = this.storage.getUsageStats();
      return stats.consecutiveErrors >= 3;
    }

    increaseCooldown() {
      this.cooldownMultiplier *= 2;
    }

    resetCooldown() {
      this.cooldownMultiplier = 1;
      this.storage.resetConsecutiveErrors();
    }

    checkDiversity(newComment, recentComments) {
      if (recentComments.length === 0) return true;
      const newHash = hashString(newComment);
      for (const rc of recentComments) {
        const rcHash = hashString(rc);
        if (newHash === rcHash) return false;
      }
      return true;
    }

    getHeaders() {
      return {
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Content-Type': 'application/x-www-form-urlencoded'
      };
    }
  }

  class BilibiliCommentManager {
    constructor() {
      this.panelVisible = false;
      this.currentTab = 'fetch';
      this.storage = new CommentStorage();
      this.obfuscator = new CommentObfuscator();
      this.antiBan = new AntiBanManager(this.storage);
      this.sendTimer = null;
      this.isSending = false;
      this.recentSentComments = [];
      this.sendSchedule = [];
      this.currentIndex = 0;
      this.init();
    }

    init() {
      this.injectStyles();
      this.createFloatingButton();
      this.createPanel();
      this.bindEvents();
      this.loadSettings();
      this.updateMaterialDisplay();
      this.updateStatusDisplay();
    }

    injectStyles() {
      const css = `
        :root {
          --bcm-primary: #00a1d6;
          --bcm-primary-hover: #0084b0;
          --bcm-bg-dark: #1a1a1a;
          --bcm-bg-panel: #2a2a2a;
          --bcm-bg-tab: #333333;
          --bcm-bg-tab-active: #404040;
          --bcm-text-primary: #ffffff;
          --bcm-text-secondary: #b3b3b3;
          --bcm-border: #444444;
          --bcm-success: #2ecc71;
          --bcm-warning: #f39c12;
          --bcm-danger: #e74c3c;
          --bcm-radius: 8px;
          --bcm-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }

        #bcm-floating-btn {
          position: fixed;
          bottom: 100px;
          right: 20px;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: var(--bcm-primary);
          border: none;
          cursor: pointer;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--bcm-shadow);
          transition: all 0.3s ease;
          color: var(--bcm-text-primary);
          font-size: 24px;
        }

        #bcm-floating-btn:hover {
          background: var(--bcm-primary-hover);
          transform: scale(1.1);
        }

        #bcm-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 800px;
          max-height: 80vh;
          background: var(--bcm-bg-panel);
          border-radius: var(--bcm-radius);
          box-shadow: var(--bcm-shadow);
          z-index: 1000000;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        #bcm-panel.hidden { display: none; }

        #bcm-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          background: var(--bcm-bg-dark);
          border-bottom: 1px solid var(--bcm-border);
        }

        #bcm-header h2 {
          margin: 0;
          color: var(--bcm-text-primary);
          font-size: 18px;
        }

        #bcm-close-btn {
          background: transparent;
          border: none;
          color: var(--bcm-text-secondary);
          cursor: pointer;
          font-size: 24px;
          padding: 0 8px;
          transition: color 0.2s;
        }

        #bcm-close-btn:hover { color: var(--bcm-danger); }

        #bcm-tabs {
          display: flex;
          background: var(--bcm-bg-tab);
          border-bottom: 1px solid var(--bcm-border);
        }

        .bcm-tab {
          flex: 1;
          padding: 12px 16px;
          background: transparent;
          border: none;
          color: var(--bcm-text-secondary);
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
          text-align: center;
        }

        .bcm-tab:hover { background: var(--bcm-bg-tab-active); }

        .bcm-tab.active {
          background: var(--bcm-bg-panel);
          color: var(--bcm-primary);
          border-bottom: 2px solid var(--bcm-primary);
        }

        #bcm-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }

        .bcm-tab-content { display: none; }
        .bcm-tab-content.active {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .bcm-form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bcm-form-group label {
          color: var(--bcm-text-primary);
          font-size: 14px;
          font-weight: 500;
        }

        .bcm-form-group input,
        .bcm-form-group textarea,
        .bcm-form-group select {
          padding: 10px 12px;
          background: var(--bcm-bg-dark);
          border: 1px solid var(--bcm-border);
          border-radius: 4px;
          color: var(--bcm-text-primary);
          font-size: 14px;
        }

        .bcm-form-group textarea { min-height: 100px; resize: vertical; }

        .bcm-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .bcm-btn-primary { background: var(--bcm-primary); color: var(--bcm-text-primary); }
        .bcm-btn-primary:hover { background: var(--bcm-primary-hover); }
        .bcm-btn-success { background: var(--bcm-success); color: var(--bcm-text-primary); }
        .bcm-btn-danger { background: var(--bcm-danger); color: var(--bcm-text-primary); }
        .bcm-btn-warning { background: var(--bcm-warning); color: var(--bcm-text-primary); }
        .bcm-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .bcm-btn-group { display: flex; gap: 12px; flex-wrap: wrap; }

        .bcm-status-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: var(--bcm-bg-dark);
          border-radius: 4px;
        }

        .bcm-status-label { color: var(--bcm-text-secondary); }
        .bcm-status-value { color: var(--bcm-text-primary); font-weight: 500; }
        .bcm-status-value.success { color: var(--bcm-success); }
        .bcm-status-value.warning { color: var(--bcm-warning); }
        .bcm-status-value.danger { color: var(--bcm-danger); }

        .bcm-list { display: flex; flex-direction: column; gap: 8px; }

        .bcm-list-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: var(--bcm-bg-dark);
          border-radius: 4px;
        }

        .bcm-list-item-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .bcm-list-item-title { color: var(--bcm-text-primary); }
        .bcm-list-item-desc { color: var(--bcm-text-secondary); font-size: 12px; }

        .bcm-empty { text-align: center; padding: 40px; color: var(--bcm-text-secondary); }

        .bcm-log {
          max-height: 300px;
          overflow-y: auto;
          padding: 12px;
          background: var(--bcm-bg-dark);
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 12px;
        }

        .bcm-log-entry { padding: 4px 0; border-bottom: 1px solid var(--bcm-border); color: var(--bcm-text-secondary); }
        .bcm-log-entry.info { color: var(--bcm-primary); }
        .bcm-log-entry.success { color: var(--bcm-success); }
        .bcm-log-entry.error { color: var(--bcm-danger); }

        #bcm-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.6);
          z-index: 999999;
        }

        #bcm-overlay.hidden { display: none; }

        .bcm-checkbox-group { display: flex; flex-wrap: wrap; gap: 16px; }
        .bcm-checkbox-group label { display: flex; align-items: center; gap: 8px; color: var(--bcm-text-primary); cursor: pointer; }

        .bcm-progress { width: 100%; height: 8px; background: var(--bcm-bg-dark); border-radius: 4px; overflow: hidden; }
        .bcm-progress-bar { height: 100%; background: var(--bcm-primary); transition: width 0.3s ease; }

        .bcm-comment-preview {
          padding: 8px 12px;
          background: var(--bcm-bg-dark);
          border-radius: 4px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .bcm-comment-text { flex: 1; color: var(--bcm-text-primary); font-size: 13px; word-break: break-all; }
        .bcm-comment-meta { color: var(--bcm-text-secondary); font-size: 11px; margin-left: 12px; white-space: nowrap; }

        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--bcm-bg-dark); }
        ::-webkit-scrollbar-thumb { background: var(--bcm-border); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }

        .bcm-section { padding: 12px; background: var(--bcm-bg-dark); border-radius: 4px; margin-bottom: 12px; }
        .bcm-section h4 { margin: 0 0 12px 0; color: var(--bcm-text-primary); font-size: 14px; }

        .bcm-countdown { font-size: 24px; font-weight: bold; color: var(--bcm-primary); text-align: center; padding: 20px; }
      `;
      GM_addStyle(css);
    }

    createFloatingButton() {
      const btn = document.createElement('button');
      btn.id = 'bcm-floating-btn';
      btn.innerHTML = '📝';
      btn.title = 'B站评论管理器';
      document.body.appendChild(btn);
    }

    createPanel() {
      const overlay = document.createElement('div');
      overlay.id = 'bcm-overlay';
      overlay.className = 'hidden';
      document.body.appendChild(overlay);

      const panel = document.createElement('div');
      panel.id = 'bcm-panel';
      panel.className = 'hidden';
      panel.innerHTML = `
        <div id="bcm-header">
          <h2>📝 B站自动评论管理助手</h2>
          <button id="bcm-close-btn">&times;</button>
        </div>
        <div id="bcm-tabs">
          <button class="bcm-tab active" data-tab="fetch">评论抓取</button>
          <button class="bcm-tab" data-tab="material">素材库管理</button>
          <button class="bcm-tab" data-tab="schedule">定时发送配置</button>
          <button class="bcm-tab" data-tab="status">运行状态</button>
        </div>
        <div id="bcm-content">
          <div id="bcm-tab-fetch" class="bcm-tab-content active">
            <div class="bcm-form-group">
              <label>目标视频链接</label>
              <input type="text" id="bcm-video-url" placeholder="例如: https://www.bilibili.com/video/BV1xx411c7mD">
            </div>
            <div class="bcm-form-group">
              <label>排序方式</label>
              <select id="bcm-sort-type">
                <option value="hot">最热评论</option>
                <option value="new">最新评论</option>
              </select>
            </div>
            <div class="bcm-form-group">
              <label>抓取页数（每页19条）</label>
              <input type="number" id="bcm-fetch-pages" value="1" min="1" max="50">
            </div>
            <div class="bcm-btn-group">
              <button class="bcm-btn bcm-btn-primary" id="bcm-start-fetch-btn">开始抓取</button>
            </div>
            <div id="bcm-fetch-progress"></div>
            <div id="bcm-fetch-result"></div>
          </div>
          <div id="bcm-tab-material" class="bcm-tab-content">
            <div class="bcm-form-group">
              <label>素材库容量</label>
              <input type="number" id="bcm-capacity" value="200" min="10" max="1000">
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">当前评论数</span>
              <span class="bcm-status-value" id="bcm-current-count">0</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">未使用评论数</span>
              <span class="bcm-status-value" id="bcm-unused-count">0</span>
            </div>
            <div class="bcm-btn-group">
              <button class="bcm-btn bcm-btn-primary" id="bcm-save-capacity">保存容量</button>
              <button class="bcm-btn bcm-btn-warning" id="bcm-reset-comments">重置使用状态</button>
              <button class="bcm-btn bcm-btn-danger" id="bcm-clear-comments">清空素材库</button>
            </div>
            <div class="bcm-form-group" style="margin-top: 12px;">
              <label>搜索评论</label>
              <input type="text" id="bcm-search-comments" placeholder="输入关键词搜索...">
            </div>
            <div id="bcm-comments-list" style="max-height: 400px; overflow-y: auto;"></div>
          </div>
          <div id="bcm-tab-schedule" class="bcm-tab-content">
            <div class="bcm-section">
              <h4>发送模式</h4>
              <div class="bcm-form-group">
                <select id="bcm-send-mode">
                  <option value="fixed">固定频次</option>
                  <option value="random">伪随机次数</option>
                </select>
              </div>
              <div id="bcm-fixed-config">
                <div class="bcm-form-group">
                  <label>发送间隔（秒）</label>
                  <input type="number" id="bcm-interval" value="60" min="30" max="3600">
                </div>
              </div>
              <div id="bcm-random-config" style="display: none;">
                <div class="bcm-form-group">
                  <label>时间窗口（小时）</label>
                  <input type="number" id="bcm-time-window" value="1" min="1" max="24">
                </div>
                <div class="bcm-form-group">
                  <label>发送次数范围（最小-最大）</label>
                  <div style="display: flex; gap: 12px;">
                    <input type="number" id="bcm-min-count" value="5" min="1" max="100" style="flex: 1;">
                    <input type="number" id="bcm-max-count" value="15" min="1" max="100" style="flex: 1;">
                  </div>
                </div>
              </div>
            </div>
            <div class="bcm-section">
              <h4>评论选择方式</h4>
              <div class="bcm-form-group">
                <select id="bcm-selection-mode">
                  <option value="sequential">按添加顺序</option>
                  <option value="random">随机抽取（不放回）</option>
                </select>
              </div>
            </div>
            <div class="bcm-section">
              <h4>评论混淆设置</h4>
              <div class="bcm-checkbox-group">
                <label><input type="checkbox" id="bcm-zero-width" checked> 零宽字符</label>
                <label><input type="checkbox" id="bcm-random-space" checked> 随机空格</label>
                <label><input type="checkbox" id="bcm-emoji-deco" checked> Emoji装饰</label>
                <label><input type="checkbox" id="bcm-homophone"> 同音字替换</label>
              </div>
            </div>
            <div class="bcm-section">
              <h4>风控设置</h4>
              <div class="bcm-form-group">
                <label>每日最大发送量</label>
                <input type="number" id="bcm-daily-limit" value="50" min="10" max="200">
              </div>
              <div class="bcm-form-group">
                <label>活跃时段（开始-结束）</label>
                <div style="display: flex; gap: 12px;">
                  <input type="number" id="bcm-active-start" value="9" min="0" max="23" style="flex: 1;">
                  <input type="number" id="bcm-active-end" value="23" min="0" max="23" style="flex: 1;">
                </div>
              </div>
            </div>
            <div class="bcm-btn-group">
              <button class="bcm-btn bcm-btn-success" id="bcm-start-send">启动发送</button>
              <button class="bcm-btn bcm-btn-warning" id="bcm-pause-send" disabled>暂停发送</button>
              <button class="bcm-btn bcm-btn-danger" id="bcm-stop-send" disabled>停止发送</button>
            </div>
            <div id="bcm-countdown-display"></div>
          </div>
          <div id="bcm-tab-status" class="bcm-tab-content">
            <div class="bcm-status-item">
              <span class="bcm-status-label">运行状态</span>
              <span class="bcm-status-value" id="bcm-run-status">未运行</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">今日已发送</span>
              <span class="bcm-status-value" id="bcm-today-sent">0</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">累计已发送</span>
              <span class="bcm-status-value" id="bcm-total-sent">0</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">素材库总量</span>
              <span class="bcm-status-value" id="bcm-material-count">0</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">未使用评论</span>
              <span class="bcm-status-value" id="bcm-unused-display">0</span>
            </div>
            <div class="bcm-status-item">
              <span class="bcm-status-label">连续错误次数</span>
              <span class="bcm-status-value" id="bcm-consecutive-errors">0</span>
            </div>
            <h3 style="color: var(--bcm-text-primary); margin-top: 20px;">运行日志</h3>
            <div class="bcm-log" id="bcm-log-container"></div>
            <div class="bcm-btn-group">
              <button class="bcm-btn bcm-btn-danger" id="bcm-clear-log">清空日志</button>
              <button class="bcm-btn bcm-btn-primary" id="bcm-export-log">导出日志</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
    }

    bindEvents() {
      const floatingBtn = document.getElementById('bcm-floating-btn');
      const closeBtn = document.getElementById('bcm-close-btn');
      const overlay = document.getElementById('bcm-overlay');
      const tabs = document.querySelectorAll('.bcm-tab');

      floatingBtn.addEventListener('click', () => this.showPanel());
      closeBtn.addEventListener('click', () => this.hidePanel());
      overlay.addEventListener('click', () => this.hidePanel());

      tabs.forEach(tab => {
        tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
      });

      document.getElementById('bcm-start-fetch-btn').addEventListener('click', () => this.startFetch());
      document.getElementById('bcm-save-capacity').addEventListener('click', () => this.saveCapacity());
      document.getElementById('bcm-reset-comments').addEventListener('click', () => this.resetAllComments());
      document.getElementById('bcm-clear-comments').addEventListener('click', () => this.clearAllComments());
      document.getElementById('bcm-search-comments').addEventListener('input', (e) => this.searchComments(e.target.value));

      document.getElementById('bcm-send-mode').addEventListener('change', (e) => {
        document.getElementById('bcm-fixed-config').style.display = e.target.value === 'fixed' ? 'block' : 'none';
        document.getElementById('bcm-random-config').style.display = e.target.value === 'random' ? 'block' : 'none';
      });

      document.getElementById('bcm-start-send').addEventListener('click', () => this.startSend());
      document.getElementById('bcm-pause-send').addEventListener('click', () => this.pauseSend());
      document.getElementById('bcm-stop-send').addEventListener('click', () => this.stopSend());

      document.getElementById('bcm-clear-log').addEventListener('click', () => this.clearLog());
      document.getElementById('bcm-export-log').addEventListener('click', () => this.exportLog());
    }

    loadSettings() {
      const config = this.storage.getConfig();
      const antiBan = this.storage.getAntiBanConfig();
      const obf = this.storage.getObfuscationSettings();

      document.getElementById('bcm-capacity').value = config.maxCapacity;
      document.getElementById('bcm-interval').value = antiBan.minInterval;
      document.getElementById('bcm-daily-limit').value = antiBan.dailyLimit;
      document.getElementById('bcm-active-start').value = antiBan.activeHours.start;
      document.getElementById('bcm-active-end').value = antiBan.activeHours.end;

      document.getElementById('bcm-zero-width').checked = obf.zeroWidthChars;
      document.getElementById('bcm-random-space').checked = obf.randomSpaces;
      document.getElementById('bcm-emoji-deco').checked = obf.emojiDecoration;
      document.getElementById('bcm-homophone').checked = obf.homophoneReplace;
    }

    showPanel() {
      const panel = document.getElementById('bcm-panel');
      const overlay = document.getElementById('bcm-overlay');
      panel.classList.remove('hidden');
      overlay.classList.remove('hidden');
      this.panelVisible = true;
      this.updateMaterialDisplay();
      this.updateStatusDisplay();
      this.renderLogs();
    }

    hidePanel() {
      const panel = document.getElementById('bcm-panel');
      const overlay = document.getElementById('bcm-overlay');
      panel.classList.add('hidden');
      overlay.classList.add('hidden');
      this.panelVisible = false;
    }

    switchTab(tabName) {
      const tabs = document.querySelectorAll('.bcm-tab');
      const contents = document.querySelectorAll('.bcm-tab-content');
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
      document.getElementById(`bcm-tab-${tabName}`).classList.add('active');
      this.currentTab = tabName;
      if (tabName === 'status') this.updateStatusDisplay();
      if (tabName === 'material') this.updateMaterialDisplay();
    }

    parseVideoUrl(url) {
      const bvMatch = url.match(/BV([A-Za-z0-9]+)/);
      if (bvMatch) return { type: 'bv', value: 'BV' + bvMatch[1] };
      const avMatch = url.match(/av(\d+)/);
      if (avMatch) return { type: 'av', value: avMatch[1] };
      return null;
    }

    async convertBvToOid(bv) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://api.bilibili.com/x/web-interface/view?bvid=${bv}`,
          headers: { 'Referer': 'https://www.bilibili.com/' },
          onload: (response) => {
            try {
              const data = JSON.parse(response.responseText);
              if (data.code === 0) {
                resolve(data.data.aid.toString());
              } else {
                reject(new Error(data.message || '获取视频信息失败'));
              }
            } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('网络请求失败'))
        });
      });
    }

    async startFetch() {
      const urlInput = document.getElementById('bcm-video-url');
      const sortSelect = document.getElementById('bcm-sort-type');
      const pagesInput = document.getElementById('bcm-fetch-pages');
      const progressDiv = document.getElementById('bcm-fetch-progress');
      const resultDiv = document.getElementById('bcm-fetch-result');

      const url = urlInput.value.trim();
      const parsed = this.parseVideoUrl(url);
      if (!parsed) {
        this.addLog('请输入有效的B站视频链接', 'error');
        return;
      }

      let oid = parsed.type === 'av' ? parsed.value : null;
      if (parsed.type === 'bv') {
        try {
          this.addLog(`正在转换BV号 ${parsed.value} 为oid...`, 'info');
          oid = await this.convertBvToOid(parsed.value);
          this.addLog(`转换成功，oid: ${oid}`, 'success');
        } catch (e) {
          this.addLog(`BV号转换失败: ${e.message}`, 'error');
          return;
        }
      }

      const sortMode = sortSelect.value === 'hot' ? 1 : 0;
      const totalPages = parseInt(pagesInput.value) || 1;

      progressDiv.innerHTML = '<div class="bcm-progress"><div class="bcm-progress-bar" id="bcm-progress-bar"></div></div><div style="text-align: center; color: var(--bcm-text-secondary); font-size: 12px;" id="bcm-progress-text">0/' + totalPages + '</div>';

      let totalComments = 0;
      const startTime = Date.now();

      for (let page = 1; page <= totalPages; page++) {
        this.addLog(`正在抓取第 ${page}/${totalPages} 页...`, 'info');

        const comments = await this.fetchCommentsByPage(oid, page, sortMode);
        if (comments && comments.length > 0) {
          const added = this.storage.addComments(comments);
          totalComments += added;
          this.addLog(`第 ${page} 页抓取完成，获取 ${comments.length} 条，新增 ${added} 条`, 'success');
        } else {
          this.addLog(`第 ${page} 页无更多评论`, 'warning');
        }

        const progress = Math.round((page / totalPages) * 100);
        document.getElementById('bcm-progress-bar').style.width = progress + '%';
        document.getElementById('bcm-progress-text').textContent = `${page}/${totalPages} (${progress}%)`;

        await this.sleep(1500 + Math.random() * 1000);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      resultDiv.innerHTML = `<div class="bcm-status-item">
        <span class="bcm-status-label">抓取完成</span>
        <span class="bcm-status-value success">共获取 ${totalComments} 条评论，耗时 ${elapsed} 秒</span>
      </div>`;

      this.addLog(`抓取完成，共新增 ${totalComments} 条评论`, 'success');
      this.showNotification(`评论抓取完成，共 ${totalComments} 条`, 'success');
      this.updateMaterialDisplay();
    }

    fetchCommentsByPage(oid, page, sort) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://api.bilibili.com/x/v2/reply?type=1&oid=${oid}&pn=${page}&ps=19&sort=${sort}`,
          headers: { 'Referer': `https://www.bilibili.com/video/av${oid}` },
          onload: (response) => {
            try {
              const data = JSON.parse(response.responseText);
              if (data.code === 0 && data.data && data.data.replies) {
                const comments = data.data.replies.map(r => ({
                  content: r.content && r.content.message ? r.content.message : '',
                  author: r.member && r.member.uname ? r.member.uname : '',
                  likeCount: r.like || 0,
                  fetchTime: Date.now()
                }));
                resolve(comments);
              } else if (data.code === 0) {
                resolve([]);
              } else {
                reject(new Error(data.message || 'API返回错误'));
              }
            } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('网络请求失败'))
        });
      });
    }

    saveCapacity() {
      const cap = parseInt(document.getElementById('bcm-capacity').value);
      if (isNaN(cap) || cap < 10 || cap > 1000) {
        this.addLog('容量必须在10-1000之间', 'error');
        return;
      }
      this.storage.setCapacity(cap);
      this.addLog(`容量已设置为 ${cap}`, 'success');
      this.updateMaterialDisplay();
    }

    resetAllComments() {
      if (confirm('确定要重置所有评论的使用状态吗？')) {
        this.storage.resetAllComments();
        this.addLog('所有评论使用状态已重置', 'warning');
        this.updateMaterialDisplay();
      }
    }

    clearAllComments() {
      if (confirm('确定要清空整个素材库吗？此操作不可恢复！')) {
        this.storage.clearAll();
        this.addLog('素材库已清空', 'danger');
        this.updateMaterialDisplay();
      }
    }

    searchComments(keyword) {
      this.updateMaterialDisplay(keyword);
    }

    updateMaterialDisplay(keyword = '') {
      const comments = this.storage.getComments();
      const unused = this.storage.getUnusedCount();
      const total = this.storage.getTotalCount();

      document.getElementById('bcm-current-count').textContent = total;
      document.getElementById('bcm-unused-count').textContent = unused;

      const listDiv = document.getElementById('bcm-comments-list');
      let filtered = comments;
      if (keyword) {
        filtered = comments.filter(c => c.content.toLowerCase().includes(keyword.toLowerCase()));
      }

      if (filtered.length === 0) {
        listDiv.innerHTML = '<div class="bcm-empty">暂无评论素材</div>';
        return;
      }

      const sorted = [...filtered].reverse().slice(0, 50);
      listDiv.innerHTML = sorted.map(c => `
        <div class="bcm-comment-preview" data-id="${c.id}">
          <div class="bcm-comment-text">${this.escapeHtml(c.content.substring(0, 80))}${c.content.length > 80 ? '...' : ''}</div>
          <div class="bcm-comment-meta">
            ${c.isUsed ? '<span style="color: var(--bcm-warning);">已使用</span>' : '<span style="color: var(--bcm-success);">未使用</span>'}
            | ${c.author}
            | ${new Date(c.fetchTime).toLocaleDateString()}
            <button class="bcm-btn bcm-btn-danger" style="padding: 4px 8px; margin-left: 8px; font-size: 11px;" onclick="window.__bcm.deleteComment('${c.id}')">删除</button>
          </div>
        </div>
      `).join('');
    }

    deleteComment(id) {
      this.storage.deleteComment(id);
      this.addLog('评论已删除', 'info');
      this.updateMaterialDisplay(document.getElementById('bcm-search-comments').value);
    }

    getObfuscationSettings() {
      return {
        zeroWidthChars: document.getElementById('bcm-zero-width').checked,
        randomSpaces: document.getElementById('bcm-random-space').checked,
        emojiDecoration: document.getElementById('bcm-emoji-deco').checked,
        homophoneReplace: document.getElementById('bcm-homophone').checked
      };
    }

    selectNextComment() {
      const mode = document.getElementById('bcm-selection-mode').value;
      const unused = this.storage.getComments('unused');

      if (unused.length === 0) {
        return null;
      }

      if (mode === 'sequential') {
        const comment = unused[0];
        return comment;
      } else {
        const index = Math.floor(Math.random() * unused.length);
        return unused[index];
      }
    }

    getCookies() {
      const cookies = document.cookie.split(';');
      let sessdata = '';
      let biliJct = '';
      for (const c of cookies) {
        const [name, value] = c.trim().split('=');
        if (name === 'SESSDATA') sessdata = value;
        if (name === 'bili_jct') biliJct = value;
      }
      return { sessdata, biliJct };
    }

    sendComment(oid, message) {
      return new Promise((resolve, reject) => {
        const { biliJct } = this.getCookies();
        if (!biliJct) {
          reject(new Error('未找到CSRF Token，请确保已登录B站'));
          return;
        }

        const obfSettings = this.getObfuscationSettings();
        const obfuscated = this.obfuscator.obfuscate(message, obfSettings);

        this.storage.setObfuscationSettings(obfSettings);

        if (obfuscated.length > 1000) {
          reject(new Error('评论过长，超过1000字符限制'));
          return;
        }

        const body = `type=1&oid=${oid}&message=${encodeURIComponent(obfuscated)}&csrf=${biliJct}&plat=1`;

        GM_xmlhttpRequest({
          method: 'POST',
          url: 'https://api.bilibili.com/x/v2/reply/add',
          headers: this.antiBan.getHeaders(),
          data: body,
          onload: (response) => {
            try {
              const data = JSON.parse(response.responseText);
              if (data.code === 0) {
                resolve(data);
              } else {
                reject(new Error(data.message || `错误码: ${data.code}`));
              }
            } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('网络请求失败'))
        });
      });
    }

    async startSend() {
      const mode = document.getElementById('bcm-send-mode').value;
      const dailyLimit = parseInt(document.getElementById('bcm-daily-limit').value);
      const activeStart = parseInt(document.getElementById('bcm-active-start').value);
      const activeEnd = parseInt(document.getElementById('bcm-active-end').value);

      this.storage.setAntiBanConfig('dailyLimit', dailyLimit);
      this.storage.setAntiBanConfig('activeHours', { start: activeStart, end: activeEnd });

      if (!this.antiBan.isActiveHours()) {
        this.addLog('当前不在活跃时段，发送将暂停', 'warning');
        return;
      }

      if (!this.antiBan.canSendToday()) {
        this.addLog('今日发送量已达上限', 'warning');
        return;
      }

      this.isSending = true;
      document.getElementById('bcm-start-send').disabled = true;
      document.getElementById('bcm-pause-send').disabled = false;
      document.getElementById('bcm-stop-send').disabled = false;
      this.addLog('定时发送已启动', 'success');

      if (mode === 'fixed') {
        await this.runFixedMode();
      } else {
        await this.runRandomMode();
      }
    }

    async runFixedMode() {
      const baseInterval = parseInt(document.getElementById('bcm-interval').value) * 1000;

      while (this.isSending) {
        if (!this.antiBan.isActiveHours()) {
          this.addLog('非活跃时段，等待中...', 'warning');
          await this.sleep(60000);
          continue;
        }

        if (!this.antiBan.canSendToday()) {
          this.addLog('今日发送量已达上限，暂停发送', 'warning');
          this.stopSend();
          return;
        }

        if (this.antiBan.shouldCooldown()) {
          this.addLog('连续错误次数过多，发送已自动停止', 'error');
          this.stopSend();
          return;
        }

        if (this.antiBan.shouldIncreaseCooldown()) {
          this.antiBan.increaseCooldown();
          this.addLog('检测到连续错误，冷却时间加倍', 'warning');
        }

        await this.sleep(this.antiBan.getRandomWait());

        const comment = this.selectNextComment();
        if (!comment) {
          this.addLog('素材库中无未使用评论', 'warning');
          this.stopSend();
          return;
        }

        const recentContents = this.recentSentComments.slice(-10).map(c => c.content);
        if (!this.antiBan.checkDiversity(comment.content, recentContents)) {
          this.addLog('评论内容相似度过高，跳过', 'warning');
          this.storage.markCommentUsed(comment.id);
          continue;
        }

        try {
          const urlInput = document.getElementById('bcm-video-url');
          const parsed = this.parseVideoUrl(urlInput.value);
          if (!parsed) {
            this.addLog('请先输入有效的视频链接', 'error');
            break;
          }

          let oid = parsed.type === 'av' ? parsed.value : null;
          if (parsed.type === 'bv') {
            oid = await this.convertBvToOid(parsed.value);
          }

          await this.sendComment(oid, comment.content);

          this.storage.markCommentUsed(comment.id);
          this.storage.incrementSent();
          this.recentSentComments.push({ content: comment.content, time: Date.now() });
          this.antiBan.resetCooldown();

          this.addLog(`发送成功: ${comment.content.substring(0, 20)}...`, 'success');
        } catch (e) {
          this.storage.incrementError();
          this.addLog(`发送失败: ${e.message}`, 'error');
        }

        this.updateStatusDisplay();

        if (this.isSending) {
          const delay = this.antiBan.getDelay(baseInterval);
          this.addLog(`等待 ${Math.round(delay / 1000)} 秒后发送下一条评论`, 'info');
          this.showCountdown(delay);
          await this.sleep(delay);
        }
      }
    }

    async runRandomMode() {
      const timeWindow = parseInt(document.getElementById('bcm-time-window').value);
      const minCount = parseInt(document.getElementById('bcm-min-count').value);
      const maxCount = parseInt(document.getElementById('bcm-max-count').value);

      const targetCount = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
      const windowMs = timeWindow * 60 * 60 * 1000;
      const avgInterval = windowMs / targetCount;

      this.addLog(`伪随机模式：${timeWindow}小时内发送${targetCount}次，平均间隔${Math.round(avgInterval / 1000)}秒`, 'info');

      const sendTimes = [];
      const now = Date.now();
      for (let i = 0; i < targetCount; i++) {
        const time = now + Math.random() * windowMs;
        sendTimes.push(time);
      }
      sendTimes.sort((a, b) => a - b);

      for (const sendTime of sendTimes) {
        if (!this.isSending) return;

        const waitTime = sendTime - Date.now();
        if (waitTime > 0) {
          this.showCountdown(waitTime);
          await this.sleep(waitTime);
        }

        if (!this.isSending) return;
        if (!this.antiBan.isActiveHours()) {
          this.addLog('非活跃时段，跳过本次发送', 'warning');
          continue;
        }
        if (!this.antiBan.canSendToday()) {
          this.addLog('今日发送量已达上限', 'warning');
          break;
        }
        if (this.antiBan.shouldCooldown()) {
          this.addLog('连续错误过多，停止发送', 'error');
          this.stopSend();
          return;
        }

        await this.sleep(this.antiBan.getRandomWait());

        const comment = this.selectNextComment();
        if (!comment) {
          this.addLog('素材库中无未使用评论', 'warning');
          break;
        }

        try {
          const urlInput = document.getElementById('bcm-video-url');
          const parsed = this.parseVideoUrl(urlInput.value);
          if (!parsed) break;

          let oid = parsed.type === 'av' ? parsed.value : null;
          if (parsed.type === 'bv') {
            oid = await this.convertBvToOid(parsed.value);
          }

          await this.sendComment(oid, comment.content);

          this.storage.markCommentUsed(comment.id);
          this.storage.incrementSent();
          this.recentSentComments.push({ content: comment.content, time: Date.now() });
          this.antiBan.resetCooldown();

          this.addLog(`发送成功: ${comment.content.substring(0, 20)}...`, 'success');
        } catch (e) {
          this.storage.incrementError();
          this.addLog(`发送失败: ${e.message}`, 'error');
        }

        this.updateStatusDisplay();
      }

      this.addLog('伪随机发送周期完成', 'success');
      this.stopSend();
    }

    showCountdown(ms) {
      const display = document.getElementById('bcm-countdown-display');
      if (!display) return;

      const totalSeconds = Math.floor(ms / 1000);
      let remaining = totalSeconds;

      const update = () => {
        if (!this.isSending || remaining <= 0) {
          display.innerHTML = '';
          return;
        }

        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        display.innerHTML = `<div class="bcm-countdown">下次发送倒计时: ${minutes}:${seconds.toString().padStart(2, '0')}</div>`;
        remaining--;
        setTimeout(update, 1000);
      };

      update();
    }

    pauseSend() {
      this.isSending = false;
      document.getElementById('bcm-start-send').disabled = false;
      document.getElementById('bcm-pause-send').disabled = true;
      document.getElementById('bcm-stop-send').disabled = true;
      document.getElementById('bcm-countdown-display').innerHTML = '';
      this.addLog('定时发送已暂停', 'warning');
    }

    stopSend() {
      this.isSending = false;
      document.getElementById('bcm-start-send').disabled = false;
      document.getElementById('bcm-pause-send').disabled = true;
      document.getElementById('bcm-stop-send').disabled = true;
      document.getElementById('bcm-countdown-display').innerHTML = '';
      this.antiBan.resetCooldown();
      this.addLog('定时发送已停止', 'info');
    }

    updateStatusDisplay() {
      const stats = this.storage.getUsageStats();
      const total = this.storage.getTotalCount();
      const unused = this.storage.getUnusedCount();

      const runStatus = document.getElementById('bcm-run-status');
      if (runStatus) {
        runStatus.textContent = this.isSending ? '运行中' : '未运行';
        runStatus.className = `bcm-status-value ${this.isSending ? 'success' : ''}`;
      }

      const todaySent = document.getElementById('bcm-today-sent');
      if (todaySent) todaySent.textContent = stats.todaySent;

      const totalSent = document.getElementById('bcm-total-sent');
      if (totalSent) totalSent.textContent = stats.totalSent;

      const materialCount = document.getElementById('bcm-material-count');
      if (materialCount) materialCount.textContent = total;

      const unusedDisplay = document.getElementById('bcm-unused-display');
      if (unusedDisplay) unusedDisplay.textContent = unused;

      const consecutiveErrors = document.getElementById('bcm-consecutive-errors');
      if (consecutiveErrors) {
        consecutiveErrors.textContent = stats.consecutiveErrors;
        consecutiveErrors.className = `bcm-status-value ${stats.consecutiveErrors > 0 ? 'danger' : ''}`;
      }
    }

    addLog(message, type = 'info') {
      this.storage.addLog(type, message);
      this.renderLogs();
    }

    renderLogs() {
      const logContainer = document.getElementById('bcm-log-container');
      if (!logContainer) return;

      const logs = this.storage.getLogs();
      logContainer.innerHTML = logs.slice(0, 50).map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        return `<div class="bcm-log-entry ${log.type}">[${time}] ${log.content}${log.detail ? ' - ' + log.detail : ''}</div>`;
      }).join('');
    }

    clearLog() {
      this.storage.clearLogs();
      this.renderLogs();
      this.addLog('日志已清空', 'info');
    }

    exportLog() {
      const logs = this.storage.getLogs();
      if (logs.length === 0) {
        this.addLog('没有可导出的日志', 'warning');
        return;
      }

      let logText = 'B站自动评论管理助手 - 运行日志\n';
      logText += `导出时间: ${new Date().toLocaleString()}\n`;
      logText += '='.repeat(50) + '\n\n';

      logs.slice().reverse().forEach(log => {
        const time = new Date(log.timestamp).toLocaleString();
        logText += `[${time}] [${log.type}] ${log.content}${log.detail ? ' - ' + log.detail : ''}\n`;
      });

      const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bcm-log-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);

      this.addLog('日志已导出', 'success');
    }

    showNotification(message, type = 'info') {
      GM_notification({
        title: 'B站自动评论管理助手',
        text: message,
        timeout: 3000,
        type: type
      });
    }

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  window.__bcm = null;

  const init = () => {
    try {
      if (document.body) {
        console.log('[B站评论管理器] 开始初始化...');
        window.__bcm = new BilibiliCommentManager();
        console.log('[B站评论管理器] 初始化成功！浮动按钮已创建');
        
        // 添加一个临时的调试标记
        const debugDiv = document.createElement('div');
        debugDiv.style.cssText = 'position:fixed;top:10px;left:10px;background:#2ecc71;color:white;padding:8px 16px;border-radius:4px;z-index:2147483647;font-size:14px;';
        debugDiv.textContent = '✅ B站评论管理器已加载';
        document.body.appendChild(debugDiv);
        setTimeout(() => debugDiv.remove(), 3000);
      } else {
        console.log('[B站评论管理器] document.body 不存在，等待重试...');
        setTimeout(init, 500);
      }
    } catch (e) {
      console.error('[B站评论管理器] 初始化失败:', e);
      console.error('[B站评论管理器] 错误堆栈:', e.stack);
      setTimeout(init, 1000);
    }
  };

  console.log('[B站评论管理器] 脚本已加载，等待页面初始化...');
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[B站评论管理器] DOMContentLoaded 触发');
      setTimeout(init, 1000);
    });
  } else {
    console.log('[B站评论管理器] 页面已加载，直接初始化');
    setTimeout(init, 1000);
  }
})();
