import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getAvailable, formatLocalDateInput, storageGet } from '../utils.js';

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [1000, 2000, 5000, 10000, 20000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status === 503 || response.status === 500) {
      const delay = delays[i] ?? delays[delays.length - 1];
      console.warn(`AI chat error ${response.status}. Retrying in ${delay / 1000}s (attempt ${i + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    return response;
  }
  return fetch(url, options);
};

const normalizeInventoryText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/["'`.,/\\()\-_*:+]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const INVENTORY_STOPWORDS = new Set([
  'כמה', 'יש', 'קיים', 'קיימים', 'קיימת', 'זמין', 'זמינים', 'זמינות', 'במלאי', 'במחסן',
  'כרגע', 'עכשיו', 'של', 'על', 'עם', 'בלי', 'ישנם', 'ישנה', 'נא', 'לי', 'את', 'ה',
  'מה', 'מלאי', 'נשאר', 'נותר', 'אפשר', 'אפשרי'
]);

const BLOCKED_EQUIPMENT_STATUSES = new Set(['פגום', 'בתיקון', 'נעלם', 'damaged', 'inspection', 'repair']);
const ACTIVE_RESERVATION_STATUSES = new Set(['מאושר', 'באיחור', 'approved', 'out', 'overdue']);

const normalizeStatusValue = (value = '') => String(value || '').trim().toLowerCase();
const getItemAvailableCount = (item) => Number(item?.available ?? item?.totalAvail ?? 0);

function isWorkingUnit(unit) {
  const rawStatus = String(unit?.status || '').trim();
  const normalizedStatus = normalizeStatusValue(rawStatus);
  return rawStatus === 'תקין' || normalizedStatus === 'תקין' || normalizedStatus === 'available' || normalizedStatus === 'ok';
}

function getWorkingUnitCount(equipmentItem) {
  if (Array.isArray(equipmentItem?.units)) {
    return equipmentItem.units.filter(isWorkingUnit).length;
  }
  return Math.max(0, Number(equipmentItem?.total_quantity || 0));
}

function isBlockedEquipment(equipmentItem) {
  return BLOCKED_EQUIPMENT_STATUSES.has(normalizeStatusValue(equipmentItem?.status));
}

function isActiveReservation(reservation) {
  return ACTIVE_RESERVATION_STATUSES.has(normalizeStatusValue(reservation?.status));
}

function inferInventoryTags(item) {
  const nameText = normalizeInventoryText(item?.name);
  const categoryText = normalizeInventoryText(item?.category);
  const descriptionText = normalizeInventoryText([
    item?.description,
    item?.technicalDetails,
  ].join(' '));
  const searchText = normalizeInventoryText([
    item?.name,
    item?.category,
    item?.description,
    item?.technicalDetails,
  ].join(' '));
  const tags = new Set();
  const isMicrophoneCategory = categoryText.includes('מיקרופונ');
  const isKnownMicrophoneModel = /shure\s*(sm)?57|shure\s*(sm)?58|\bsm57\b|\bsm58\b|at2020|spirit black|rode ntg|ntg1|wireless go|dji mic/.test(nameText);
  const hasMicrophoneDescription = descriptionText.includes('מיקרופון') || descriptionText.includes('מיקרופונים');
  const hasMicrophoneKeyword = searchText.includes('מיקרופונ') || /\bmic\b/.test(nameText);
  const isMicrophoneLike = isMicrophoneCategory || isKnownMicrophoneModel || hasMicrophoneDescription || hasMicrophoneKeyword;
  const isCondenserMicrophone = /at2020|spirit black/.test(nameText)
    || descriptionText.includes('מיקרופון קונדנסר')
    || descriptionText.includes('מיקרופון קונדנסור')
    || descriptionText.includes('קונדנסר');
  const isDynamicMicrophone = /shure\s*(sm)?57|shure\s*(sm)?58|\bsm57\b|\bsm58\b/.test(nameText)
    || descriptionText.includes('מיקרופון דינמי')
    || descriptionText.includes('מיקרופונים דינמיים')
    || (isMicrophoneLike && (searchText.includes('shure 57') || searchText.includes('shure 58') || searchText.includes('sm57') || searchText.includes('sm58')));

  if (isMicrophoneLike) tags.add('microphone');
  if (isMicrophoneLike && isDynamicMicrophone && !isCondenserMicrophone) {
    tags.add('dynamic_microphone');
    tags.add('microphone');
  }
  if (isMicrophoneLike && isCondenserMicrophone) {
    tags.add('condenser_microphone');
    tags.add('microphone');
  }
  if (searchText.includes('xlr') && (searchText.includes('כבל') || searchText.includes('כבלים'))) {
    tags.add('xlr_cable');
  }

  return [...tags];
}

function formatInventoryResponse(label, items) {
  const availableItems = items.filter((item) => getItemAvailableCount(item) > 0);
  const total = availableItems.reduce((sum, item) => sum + getItemAvailableCount(item), 0);

  if (!total) {
    return `נכון לעכשיו אין ${label} זמינים במלאי.`;
  }

  const breakdown = availableItems
    .sort((a, b) => getItemAvailableCount(b) - getItemAvailableCount(a))
    .map((item) => `${item.name}: ${getItemAvailableCount(item)}`)
    .join(', ');

  return `נכון לעכשיו יש ${total} ${label} זמינים במלאי. ${breakdown}`;
}

function extractInventoryTokens(question) {
  return normalizeInventoryText(question)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !INVENTORY_STOPWORDS.has(token));
}

function answerInventoryQuestion(question, inventoryItems) {
  const normalizedQuestion = normalizeInventoryText(question);
  const asksInventory = /כמה|יש|זמין|זמינים|במלאי|נשאר|נותר/.test(normalizedQuestion);
  if (!asksInventory) return null;

  const availableInventory = inventoryItems.filter((item) => getItemAvailableCount(item) > 0);

  if (normalizedQuestion.includes('מיקרופונ') && normalizedQuestion.includes('דינמ')) {
    const matches = availableInventory.filter((item) => item.tags.includes('dynamic_microphone'));
    return formatInventoryResponse('מיקרופונים דינמיים', matches);
  }

  if (normalizedQuestion.includes('מיקרופונ') && normalizedQuestion.includes('קונדנס')) {
    const matches = availableInventory.filter((item) => item.tags.includes('condenser_microphone'));
    return formatInventoryResponse('מיקרופונים קונדנסר', matches);
  }

  if (normalizedQuestion.includes('xlr') && (normalizedQuestion.includes('כבל') || normalizedQuestion.includes('כבלים'))) {
    const matches = availableInventory.filter((item) => item.tags.includes('xlr_cable'));
    return formatInventoryResponse('כבלי XLR', matches);
  }

  if (normalizedQuestion.includes('מיקרופונ')) {
    const matches = availableInventory.filter((item) => item.tags.includes('microphone'));
    return formatInventoryResponse('מיקרופונים', matches);
  }

  const tokens = extractInventoryTokens(question);
  if (!tokens.length) return null;

  const matches = availableInventory.filter((item) =>
    tokens.every((token) => item.searchText.includes(token))
  );

  if (!matches.length) return null;

  if (matches.length === 1) {
    const [item] = matches;
    return `נכון לעכשיו יש ${getItemAvailableCount(item)} יחידות זמינות של ${item.name} במלאי.`;
  }

  return formatInventoryResponse('פריטים תואמים', matches);
}

export default function AIChatBot({ equipment = [], reservations = [], policies = {}, settings = {}, currentUser = null, refreshInventory = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'היי! אני העוזר החכם של המחסן. תאר לי מה אתה הולך לצלם/להקליט ואעזור לך להרכיב ערכה, או שאל אותי על נהלי המחסן.' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const maxRequests = parseInt(settings?.aiMaxRequests) || 5;
  const userIdentifier = currentUser?.email || currentUser?.name || 'anonymous';
  const todayKey = `ai_req_v2_${userIdentifier}_${new Date().toISOString().split('T')[0]}`;

  const getRequestsCount = () => parseInt(localStorage.getItem(todayKey)) || 0;
  const incrementRequestsCount = () => localStorage.setItem(todayKey, getRequestsCount() + 1);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.REACT_APP_GEMINI_API_KEY || "";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const currentRequests = getRequestsCount();
    if (currentRequests >= maxRequests) {
      setMessages(prev => [...prev,
        { role: 'user', content: inputValue },
        { role: 'assistant', content: `מצטער, הגעת למכסת הבקשות היומית המותרת (${maxRequests}). אנא נסה שוב מחר או פנה לצוות המחסן.` }
      ]);
      setInputValue('');
      return;
    }

    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInputValue('');
    setIsTyping(true);

    try {
      if (!apiKey) {
        throw new Error('חסר מפתח Gemini במשתני הסביבה.');
      }

      let liveEquipment = equipment;
      let liveReservations = reservations;
      try {
        if (typeof refreshInventory === 'function') {
          const refreshed = await refreshInventory();
          if (Array.isArray(refreshed?.equipment)) liveEquipment = refreshed.equipment;
          if (Array.isArray(refreshed?.reservations)) liveReservations = refreshed.reservations;
        } else {
          const [freshEquipment, freshReservations] = await Promise.all([
            storageGet('equipment'),
            storageGet('reservations'),
          ]);
          if (Array.isArray(freshEquipment)) liveEquipment = freshEquipment;
          if (Array.isArray(freshReservations)) liveReservations = freshReservations;
        }
      } catch (refreshError) {
        console.warn('AI chat inventory refresh failed', refreshError);
      }

      const now = new Date();
      const oneMinuteLater = new Date(now.getTime() + 60000);
      const currentDate = formatLocalDateInput(now);
      const currentEndDate = formatLocalDateInput(oneMinuteLater);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const currentEndTime = `${String(oneMinuteLater.getHours()).padStart(2, '0')}:${String(oneMinuteLater.getMinutes()).padStart(2, '0')}`;

      const inventorySnapshot = liveEquipment
        .map((equipmentItem) => {
          const workingCount = getWorkingUnitCount(equipmentItem);
          const totalAvail = getAvailable(
            equipmentItem.id,
            currentDate,
            currentEndDate,
            liveReservations,
            liveEquipment,
            null,
            currentTime,
            currentEndTime
          );

          if (!equipmentItem?.name || isBlockedEquipment(equipmentItem) || workingCount <= 0) {
            return null;
          }

          return {
            id: equipmentItem.id,
            name: equipmentItem.name,
            category: equipmentItem.category,
            totalAvail,
            available: totalAvail,
            workingCount,
            description: equipmentItem.description || "",
            technicalDetails: equipmentItem.technical_details || "",
            searchText: normalizeInventoryText([
              equipmentItem.name,
              equipmentItem.category,
              equipmentItem.description,
              equipmentItem.technical_details,
            ].join(' ')),
            tags: inferInventoryTags({
              name: equipmentItem.name,
              category: equipmentItem.category,
              description: equipmentItem.description || "",
              technicalDetails: equipmentItem.technical_details || "",
            }),
          };
        })
        .filter(Boolean);

      const availableEquipment = inventorySnapshot.map((equipmentItem) => ({
        id: equipmentItem.id,
        name: equipmentItem.name,
        category: equipmentItem.category,
        totalAvail: equipmentItem.totalAvail,
      }));

      const activeReservations = (liveReservations || [])
        .filter((reservation) => isActiveReservation(reservation))
        .map((reservation) => ({
          from: reservation.borrow_date || reservation.pickupDate || reservation.startDate || "",
          fromTime: reservation.borrow_time || reservation.startTime || "",
          to: reservation.return_date || reservation.returnDate || reservation.endDate || "",
          toTime: reservation.return_time || reservation.endTime || "",
          items: Array.isArray(reservation.items)
            ? reservation.items.map((item) => {
                const equipmentId = item?.equipment_id ?? item?.equipmentId ?? item?.id ?? "";
                const equipmentMatch = liveEquipment.find((equipmentItem) => String(equipmentItem.id) === String(equipmentId));
                return {
                  name: item?.name || equipmentMatch?.name || String(equipmentId || "").trim() || "פריט לא מזוהה",
                  amount: Number(item?.quantity) || 1,
                };
              })
            : [],
        }));

      const deterministicInventoryAnswer = answerInventoryQuestion(userMessage, inventorySnapshot);
      if (deterministicInventoryAnswer) {
        setMessages(prev => [...prev, { role: 'assistant', content: deterministicInventoryAnswer }]);
        incrementRequestsCount();
        return;
      }

      // Compact inventory string: "שם(כמות), שם(כמות)"
      const compactEquipment = availableEquipment
        .filter(e => e.totalAvail > 0)
        .map(e => `${e.name}(${e.totalAvail})`)
        .join(', ');

      // Compact reservations: "תאריך:פריטים"
      const compactReservations = activeReservations
        .map(r => {
          const items = r.items.map(i => `${i.name}x${i.amount}`).join('+');
          return `${r.from}→${r.to}:${items}`;
        })
        .join(' | ');

      const systemPrompt = `אתה עוזר מחסן ציוד. ענה בעברית, קצר וענייני. אל תשתמש ב-markdown (אין **, אין ##, אין *). כשמפרטים רשימה, השתמש בשורות רגילות עם מקף בלבד.
סטודנט: ${currentUser?.name || 'אנונימי'}
מלאי פנוי: ${compactEquipment}
השאלות פעילות: ${compactReservations}
חוקים: המלץ רק מהמלאי הפנוי. אם שואלים על נהלים, ענה: "אנא קרא את תקנון המחסן או פנה לצוות."`;

      // שמור רק 2 הודעות אחרונות לחיסכון בטוקנים
      // Gemini דורש שה-history יתחיל עם 'user' — מסיר הודעות assistant בראש
      let history = messages
        .filter(m => m.role !== 'system')
        .slice(-2)
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
      if (history.length > 0 && history[0].role === 'model') history = history.slice(1);
      history.push({ role: 'user', parts: [{ text: userMessage }] });

      let result = null;
      let lastError = null;

      for (const modelName of ['gemini-1.5-flash-8b']) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await fetchWithRetry(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: history,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = new Error(errText || `שגיאה ${response.status}`);
          if (response.status === 404 || response.status === 429 || response.status === 503) {
            continue;
          }
          throw lastError;
        }

        result = await response.json();
        if (result?.candidates?.length) break;
      }

      if (!result?.candidates?.length) {
        throw lastError || new Error("לא התקבלה תשובה תקינה מעוזר ה־AI.");
      }

      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const aiText = rawText.replace(/\*\*/g, "").replace(/^#{1,3} /gm, "").replace(/\*/g, "");

      setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
      incrementRequestsCount();

    } catch (error) {
      console.error("ChatBot error:", error);
      let errorMessage = "מצטער, חלה שגיאה בחיבור ל-AI. נסה שוב מאוחר יותר.";
      if (error.message?.includes("429") || error.status === 429 || error.toString().toLowerCase().includes("quota")) {
        errorMessage = "הגענו למכסת ה-AI היומית של המערכת (כדי לשמור על עלויות נמוכות). המערכת תתאפס ותחזור לפעול מחר בבוקר. תודה על ההבנה!";
      } else if (error.message?.includes("503") || error.status === 503) {
        errorMessage = "שרתי ה-AI של גוגל בעומס זמני. המערכת ניסתה להתחבר שוב אוטומטית — אנא נסה שוב בעוד דקה.";
      }
      setMessages(prev => [...prev, { role: 'assistant', content: errorMessage }]);
    } finally {
      setIsTyping(false);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  const panelWidth = isMobile ? Math.min(300, window.innerWidth - 24) : 340;
  const bubbleSize = isMobile ? 46 : 50;
  const bubbleIconSize = isMobile ? 22 : 24;

  // Draggable button position (default: top-right)
  const defaultBtnPos = { x: typeof window !== 'undefined' ? window.innerWidth - 62 : 12, y: 12 };
  const [btnPos, setBtnPos] = useState(() => {
    try { const s = localStorage.getItem('ai_btn_pos_v2'); return s ? JSON.parse(s) : defaultBtnPos; } catch { return defaultBtnPos; }
  });
  const posRef = useRef(btnPos);
  useEffect(() => { posRef.current = btnPos; }, [btnPos]);
  const dragRef = useRef(null);
  const isDraggingRef = useRef(false);

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    dragRef.current = { startX: t.clientX, startY: t.clientY, btnX: posRef.current.x, btnY: posRef.current.y, moved: false };
  };
  const handleTouchMove = (e) => {
    if (!dragRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - dragRef.current.startX;
    const dy = t.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const newX = Math.max(4, Math.min(window.innerWidth - bubbleSize - 4, dragRef.current.btnX + dx));
    const newY = Math.max(4, Math.min(window.innerHeight - bubbleSize - 4, dragRef.current.btnY + dy));
    setBtnPos({ x: newX, y: newY });
  };
  const handleTouchEnd = (e) => {
    if (!dragRef.current) return;
    const moved = dragRef.current.moved;
    dragRef.current = null;
    if (moved) {
      e.preventDefault();
      try { localStorage.setItem('ai_btn_pos_v2', JSON.stringify(posRef.current)); } catch {}
    }
    // if not moved, click fires naturally via onClick
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDraggingRef.current = false;
    const startX = e.clientX, startY = e.clientY;
    const btnX = posRef.current.x, btnY = posRef.current.y;

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDraggingRef.current = true;
      if (!isDraggingRef.current) return;
      const newX = Math.max(4, Math.min(window.innerWidth - bubbleSize - 4, btnX + dx));
      const newY = Math.max(4, Math.min(window.innerHeight - bubbleSize - 4, btnY + dy));
      setBtnPos({ x: newX, y: newY });
      posRef.current = { x: newX, y: newY };
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (isDraggingRef.current) {
        try { localStorage.setItem('ai_btn_pos_v2', JSON.stringify(posRef.current)); } catch {}
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const panelHeight = isMobile ? 380 : 430;
  const panelPos = (() => {
    const margin = 8;
    const bx = btnPos.x;
    const by = btnPos.y;
    const left = bx + bubbleSize / 2 > window.innerWidth / 2
      ? Math.max(margin, bx + bubbleSize - panelWidth)
      : Math.min(window.innerWidth - panelWidth - margin, bx);
    const top = by + bubbleSize / 2 > window.innerHeight / 2
      ? Math.max(margin, by - panelHeight - margin)
      : by + bubbleSize + margin;
    return { top, left };
  })();

  const panel = isOpen && (
    <div style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 2147483647, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div dir="rtl" style={{
        background: '#1a1a2e',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        border: '1px solid rgba(99,102,241,0.35)',
        width: panelWidth,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🤖</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>עוזר המחסן החכם</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>נותרו {maxRequests - getRequestsCount()} שאלות להיום</div>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            borderRadius: '50%',
            width: 28,
            height: 28,
            cursor: 'pointer',
            color: '#fff',
            fontSize: 18,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Messages */}
        <div style={{
          height: isMobile ? 240 : 290,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: '#0f0f1a',
        }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: msg.role === 'assistant' ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
              fontSize: 13,
              lineHeight: 1.5,
              alignSelf: msg.role === 'assistant' ? 'flex-start' : 'flex-end',
              background: msg.role === 'assistant' ? '#1e1e35' : '#4f46e5',
              color: msg.role === 'assistant' ? '#e2e2f0' : '#fff',
              border: msg.role === 'assistant' ? '1px solid rgba(99,102,241,0.2)' : 'none',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          ))}
          {isTyping && (
            <div style={{
              alignSelf: 'flex-start',
              background: '#1e1e35',
              border: '1px solid rgba(99,102,241,0.2)',
              borderRadius: '4px 12px 12px 12px',
              padding: '8px 14px',
              fontSize: 18,
              color: '#a5b4fc',
              letterSpacing: 4,
            }}>···</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '10px 12px',
          background: '#1a1a2e',
          borderTop: '1px solid rgba(99,102,241,0.2)',
          display: 'flex',
          gap: 8,
        }}>
          <input
            type="text"
            placeholder="שאל אותי משהו..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            style={{
              flex: 1,
              background: '#0f0f1a',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 13,
              color: '#e2e2f0',
              outline: 'none',
              direction: 'rtl',
              minWidth: 0,
            }}
          />
          <button
            onClick={handleSend}
            disabled={isTyping || !inputValue.trim()}
            style={{
              background: isTyping || !inputValue.trim() ? '#2d2d4e' : '#4f46e5',
              border: 'none',
              borderRadius: 8,
              padding: '7px 12px',
              cursor: isTyping || !inputValue.trim() ? 'not-allowed' : 'pointer',
              color: '#fff',
              fontSize: 16,
              flexShrink: 0,
            }}
          >➤</button>
        </div>
      </div>
    </div>
  );

  const floatingBtn = !isOpen && (
    <button
      onClick={() => { if (!isDraggingRef.current) setIsOpen(true); }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      title="עוזר המחסן החכם"
      style={{
        position: 'fixed',
        top: btnPos.y,
        left: btnPos.x,
        zIndex: 2147483647,
        touchAction: 'none',
        background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
        border: 'none',
        borderRadius: '50%',
        width: bubbleSize,
        height: bubbleSize,
        cursor: 'grab',
        boxShadow: '0 4px 20px rgba(99,102,241,0.55)',
        fontSize: bubbleIconSize,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'box-shadow 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 28px rgba(99,102,241,0.75)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.55)'; }}
    >
      🤖
      {getRequestsCount() < maxRequests && (
        <span style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 10,
          height: 10,
          background: '#22c55e',
          borderRadius: '50%',
          border: '2px solid #1a1a2e',
        }} />
      )}
    </button>
  );

  return createPortal(<>{panel}{floatingBtn}</>, document.body);
}
