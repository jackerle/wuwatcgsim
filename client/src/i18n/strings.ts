// Every piece of UI text the client owns, in both languages, one entry per
// key. Card data (names, printed ability text) is NOT here — it comes from
// the card database in shared/src/sets, which is Thai-only for almost every
// card (see LocalizedText in shared/src/cards.ts). Translating game rules
// text is content work for whoever authors that data, not something this
// dictionary can safely guess at — a wrong translation there would describe
// the game incorrectly, not just read awkwardly. localize()/EffectText
// already fall back to whichever language IS filled in, so English players
// still see the ability text, just in Thai, until that data grows an `en`.
//
// A value is either a plain string or a function that takes whatever varies
// (a count, a name) and returns one — t() calls it for you. Keys are grouped
// by the screen/component that owns them, in the same order those screens
// appear in the app.

export type Lang = "th" | "en";

type Value = string | ((...args: never[]) => string);

interface Entry {
  th: Value;
  en: Value;
}

export const STRINGS = {
  // --- Shared across screens ------------------------------------------------
  "common.back": { th: "กลับ", en: "Back" },
  "common.cancel": { th: "ยกเลิก", en: "Cancel" },
  "common.confirm": { th: "ยืนยัน", en: "Confirm" },
  "common.confirmCount": {
    th: (selected: number, max: number) => `ยืนยัน (${selected}/${max})`,
    en: (selected: number, max: number) => `Confirm (${selected}/${max})`,
  },
  "common.close": { th: "ปิด", en: "Close" },
  "common.save": { th: "บันทึก", en: "Save" },
  "common.leaveRoom": { th: "ออกจากห้อง", en: "Leave Room" },
  "common.cancelQuestion": { th: "ยกเลิกการสั่ง", en: "Cancel Question" },
  "common.back.position": { th: "หลัง", en: "Back" },

  // --- MainMenu.tsx -----------------------------------------------------------
  "mainMenu.subtitle": { th: "Wuthering Waves TCG Simulator", en: "Wuthering Waves TCG Simulator" },
  "mainMenu.playerNameLabel": { th: "ชื่อผู้เล่น", en: "Player name" },
  "mainMenu.playerNamePlaceholder": { th: "ใส่ชื่อของคุณ", en: "Enter your name" },
  "mainMenu.needNameTitle": { th: "ใส่ชื่อก่อน", en: "Enter a name first" },
  "mainMenu.playSub": { th: "หาห้อง หรือสร้างห้องใหม่", en: "Find a room, or open a new one" },
  "mainMenu.deckSubWithCount": {
    th: (n: number) => `จัดเด็ค — มีอยู่ ${n} เด็ค`,
    en: (n: number) => `Decks — ${n} saved`,
  },
  "mainMenu.deckSubEmpty": { th: "จัดเด็ค — ยังไม่มีเด็ค", en: "Decks — none yet" },
  "mainMenu.hotseat": {
    th: "เล่นสองฝั่งบนจอนี้ (ไม่ต้องมีคู่)",
    en: "Play both sides on this screen (no opponent needed)",
  },
  "mainMenu.langSwitchTitle": { th: "เปลี่ยนภาษา", en: "Change language" },
  "mainMenu.credit": { th: "สร้างโดย", en: "Made by" },

  // --- PlayMenu.tsx -------------------------------------------------------
  "playMenu.title": { th: "เล่นออนไลน์", en: "Play Online" },
  "playMenu.publicRooms": { th: (n: number) => `ห้องสาธารณะ (${n})`, en: (n: number) => `Public Rooms (${n})` },
  "playMenu.noRooms": {
    th: "ยังไม่มีใครเปิดห้องรออยู่ — สร้างห้องเองได้เลย",
    en: "No one has a room open yet — go ahead and create one",
  },
  "playMenu.playerCount": { th: (n: number, max: number) => `${n}/${max} คน`, en: (n: number, max: number) => `${n}/${max} players` },
  "playMenu.join": { th: "เข้าร่วม", en: "Join" },
  "playMenu.joinWithCode": { th: "เข้าห้องด้วยรหัส", en: "Join with a Code" },
  "playMenu.codePlaceholder": { th: "เช่น AB12", en: "e.g. AB12" },
  "playMenu.createRoom": { th: "สร้างห้อง", en: "Create Room" },
  "playMenu.publicDesc": {
    th: "ใครก็เข้ามาเล่นด้วยได้ ห้องจะขึ้นในลิสต์ด้านบน",
    en: "Anyone can join — the room shows up in the list above",
  },
  "playMenu.privateDesc": {
    th: "ห้องจะไม่ขึ้นในลิสต์ ต้องบอกรหัสห้องให้เพื่อนเอง",
    en: "The room won't show up in the list — share the code with your friend yourself",
  },

  // --- Lobby.tsx ------------------------------------------------------------
  "lobby.pickDeckTitle": { th: "เลือกเด็คที่จะใช้", en: "Choose a Deck to Bring" },
  "lobby.roomHeading": { th: (code: string) => `ห้อง ${code}`, en: (code: string) => `Room ${code}` },
  "lobby.visibilityPublic": { th: "สาธารณะ", en: "Public" },
  "lobby.visibilityPrivate": { th: "ส่วนตัว", en: "Private" },
  "lobby.bothReady": { th: "ผู้เล่นครบแล้ว", en: "Both Players Ready" },
  "lobby.waitingForPlayer": { th: "รอผู้เล่นอีกคน", en: "Waiting for Another Player" },
  "lobby.shareCodeBefore": { th: "บอกรหัสห้อง", en: "Share the room code" },
  "lobby.shareCodeAfter": { th: "ให้เพื่อน", en: "with a friend" },
  "lobby.orWaitInList": {
    th: "หรือรอให้ใครสักคนเจอห้องนี้ในลิสต์",
    en: "or wait for someone to find this room in the list",
  },
  "lobby.you": { th: "(คุณ)", en: "(you)" },
  "lobby.noDeckPicked": { th: "ยังไม่ได้เลือกเด็ค", en: "Hasn't picked a deck yet" },
  "lobby.disconnectedSuffix": { th: "หลุดการเชื่อมต่อ", en: "disconnected" },
  "lobby.ready": { th: "พร้อม", en: "Ready" },
  "lobby.waiting": { th: "รอ", en: "Waiting" },
  "lobby.yourDeck": { th: "เด็คของคุณ", en: "Your Deck" },
  "lobby.change": { th: "เปลี่ยน", en: "Change" },
  "lobby.chooseDeck": { th: "เลือกเด็ค", en: "Choose Deck" },
  "lobby.buildDeckFirst": { th: "จัดเด็คก่อน", en: "Build a Deck First" },
  "lobby.playableDeckCount": {
    th: (n: number) => `มีเด็คที่เล่นได้ ${n} เด็ค`,
    en: (n: number) => `${n} playable deck(s)`,
  },
  "lobby.noFullDeck": { th: "ยังไม่มีเด็คที่ครบ 40 ใบ", en: "No deck with a full 40 cards yet" },
  "lobby.needTwoPlayersTitle": {
    th: "ต้องมีผู้เล่นสองคนและเลือกเด็คครบทั้งคู่",
    en: "Needs two players, both with a deck chosen",
  },
  "lobby.startGame": { th: "เริ่มเกม", en: "Start Game" },
  "lobby.waitingForHost": { th: "รอเจ้าของห้องกดเริ่มเกม", en: "Waiting for the host to start" },

  // --- DeckManager.tsx --------------------------------------------------------
  "deckManager.title": { th: "เด็คของฉัน", en: "My Decks" },
  "deckManager.newDeck": { th: "+ สร้างเด็คใหม่", en: "+ New Deck" },
  "deckManager.newDeckDefaultName": { th: "เด็คใหม่", en: "New Deck" },
  "deckManager.empty": {
    th: 'ยังไม่มีเด็ค — กด "สร้างเด็คใหม่" เพื่อเลือกตัวละคร 3 ตัวและจัดการ์ด',
    en: 'No decks yet — press "New Deck" to pick 3 characters and build your card list',
  },
  "deckManager.noCharacters": { th: "ยังไม่ได้เลือกตัวละคร", en: "No characters chosen yet" },
  "deckManager.cardCount": { th: (n: number) => `${n} ใบ`, en: (n: number) => `${n} cards` },
  "deckManager.playable": { th: "พร้อมเล่น", en: "Ready" },
  "deckManager.incomplete": { th: "ยังไม่ครบ", en: "Incomplete" },
  "deckManager.edit": { th: "แก้ไข", en: "Edit" },
  "deckManager.duplicate": { th: "ทำสำเนา", en: "Duplicate" },
  "deckManager.delete": { th: "ลบ", en: "Delete" },
  "deckManager.copySuffix": { th: "(สำเนา)", en: "(copy)" },

  // --- DeckBuilder.tsx ---------------------------------------------------------
  "deckBuilder.namePlaceholder": { th: "ชื่อเด็ค", en: "Deck name" },
  "deckBuilder.characters": {
    th: (chosen: number, max: number) => `ตัวละคร (${chosen}/${max})`,
    en: (chosen: number, max: number) => `Characters (${chosen}/${max})`,
  },
  "deckBuilder.maxCharactersTitle": {
    th: (max: number) => `เลือกได้ ${max} ตัวเท่านั้น`,
    en: (max: number) => `Only ${max} characters allowed`,
  },
  "deckBuilder.characterCardsNote": {
    th: (n: number) => `การ์ดตัวละคร ${n} ใบ (ทุกเลเวลของทั้งสามตัว) ถูกใส่ให้อัตโนมัติ`,
    en: (n: number) => `${n} character cards (every level of all three) are added automatically`,
  },
  "deckBuilder.leaderLevelsHeading": { th: "เลเวลของตัวละคร", en: "Character Levels" },
  "deckBuilder.availableCards": { th: "การ์ดที่เลือกได้", en: "Available Cards" },
  "deckBuilder.availableCardsCount": { th: (n: number) => `(${n} แบบ)`, en: (n: number) => `(${n} kinds)` },
  "deckBuilder.pickCharactersFirst": {
    th: "เลือกตัวละครก่อน แล้วการ์ดของพวกเขาจะขึ้นมาให้เลือก",
    en: "Choose characters first, and their cards will show up here",
  },
  "deckBuilder.maxCopiesTitle": { th: (max: number) => `สูงสุด ${max} ใบ`, en: (max: number) => `Max ${max} copies` },
  "deckBuilder.addOneTitle": { th: "เพิ่ม 1 ใบ", en: "Add 1 copy" },
  "deckBuilder.deckReady": { th: "เด็คนี้พร้อมเล่นแล้ว", en: "This deck is ready to play" },
  "deckBuilder.exportTitle": { th: "Export เด็ค", en: "Export Deck" },
  "deckBuilder.importTitle": { th: "Import เด็ค", en: "Import Deck" },
  "deckBuilder.transferHintPrefix": { th: "หนึ่งบรรทัดต่อการ์ด เช่น", en: "One card per line, e.g." },
  "deckBuilder.transferHintOr": { th: "หรือ", en: "or" },
  "deckBuilder.copied": { th: "คัดลอกแล้ว", en: "Copied" },
  "deckBuilder.copy": { th: "คัดลอก", en: "Copy" },
  "deckBuilder.doImport": { th: "นำเข้า", en: "Import" },
  "deckBuilder.share": { th: "แชร์", en: "Share" },
  "deckBuilder.shareTitle": { th: "แชร์เด็ค", en: "Share Deck" },
  "deckBuilder.shareGenerating": { th: "กำลังสร้างรูปภาพ...", en: "Generating image..." },
  "deckBuilder.shareLeaders": { th: "ตัวละคร", en: "Characters" },
  "deckBuilder.shareCards": { th: "การ์ด", en: "Cards" },
  "deckBuilder.shareTotal": { th: (n: number) => `รวม ${n} ใบ`, en: (n: number) => `${n} cards total` },
  "deckBuilder.shareDownload": { th: "ดาวน์โหลดรูปภาพ", en: "Download Image" },
  "deckBuilder.shareCopyImage": { th: "คัดลอกรูปภาพ", en: "Copy Image" },

  // --- ImagePreloadPill.tsx --------------------------------------------------
  "imagePreload.loading": {
    th: (done: number, total: number) => `กำลังโหลดรูปการ์ด… ${done}/${total}`,
    en: (done: number, total: number) => `Loading card art… ${done}/${total}`,
  },
  "imagePreload.title": {
    th: "โหลดรูปการ์ดไว้ล่วงหน้า เพื่อให้ดูตัวอย่างได้ไม่มีสะดุด",
    en: "Pre-loading card art so previews don't stutter",
  },

  // --- ControlBar.tsx -----------------------------------------------------
  "controlBar.drawTitle": { th: "จั่วการ์ดของเทิร์นนี้ — เข้าเฟสหลักต่อเอง", en: "Draw this turn's card — then continue into the Main Phase" },
  "controlBar.toBattlePrompt": { th: "ไปเฟสประลองเลยไหม", en: "Go to the Battle Phase now?" },
  "controlBar.toBattleDetail": {
    th: (actionsLeft: number) => `เหลือแอ็กชันอีก ${actionsLeft} อย่าง — ออกจากเฟสหลักแล้วย้อนกลับไม่ได้`,
    en: (actionsLeft: number) => `${actionsLeft} action(s) left — you can't come back once you leave the Main Phase`,
  },
  "controlBar.toBattleConfirm": { th: "ไปเฟสประลอง", en: "Go to Battle" },
  "controlBar.toBattleTitle": { th: "ปิดเฟสหลัก แล้วเปิดเฟสประลอง", en: "Close the Main Phase and open the Battle Phase" },
  "controlBar.judgementTitle": {
    th: "เปิดการ์ดทั้งสองฝ่าย ตัดสินผล แล้วเข้าการโจมตีต่อเนื่อง",
    en: "Reveal both sides, settle the result, then go into the Combo",
  },
  "controlBar.judgementWaiting": { th: "ต้องเลือกให้ครบทั้งสองฝ่ายก่อน", en: "Both sides need to commit first" },
  "controlBar.passPrompt": { th: "ไม่ลงการ์ดในการปะทะนี้ไหม", en: "Pass on this clash?" },
  "controlBar.passDetailCan": {
    th: "ยอมแพ้การปะทะนี้ แต่ไม่เสียการ์ด",
    en: "Give up this clash — you lose no card",
  },
  "controlBar.passDetailCannot": { th: "ไม่มีการ์ดในมือที่จ่ายไหว", en: "No card in hand you can afford" },
  "controlBar.pass": { th: "ไม่ลงการ์ด", en: "Pass" },
  "controlBar.passTitle": { th: "ไม่ลงการ์ดในการปะทะนี้", en: "Pass on this clash" },
  "controlBar.endComboPrompt": { th: "จบการโจมตีต่อเนื่องและจบเทิร์นไหม", en: "End the combo and end the turn?" },
  "controlBar.endComboDetailUnlimited": { th: "ยังต่อเนื่องได้ไม่จำกัด", en: "Still unlimited combos left" },
  "controlBar.endComboDetailRemaining": {
    th: (n: number) => `ยังเหลือสิทธิ์โจมตีต่อเนื่องอีก ${n} ครั้ง`,
    en: (n: number) => `${n} combo(s) left`,
  },
  "controlBar.endTurn": { th: "จบเทิร์น", en: "End Turn" },
  "controlBar.endComboThenTurnTitle": { th: "จบการโจมตีต่อเนื่อง แล้วจบเทิร์น", en: "End the combo, then end the turn" },
  "controlBar.gameOver": {
    th: (winner: string) => `จบเกม — ${winner}`,
    en: (winner: string) => `Game Over — ${winner}`,
  },
  "controlBar.draw": { th: "เสมอ", en: "Draw" },
  "controlBar.wins": { th: (name: string) => `${name} ชนะ`, en: (name: string) => `${name} wins` },
  "controlBar.mulliganHeading": {
    th: (name: string) => `เปลี่ยนการ์ดในมือ · ${name} เริ่มก่อน`,
    en: (name: string) => `Mulligan · ${name} goes first`,
  },
  "controlBar.mulliganHint": {
    th: "เลือกการ์ดที่จะคืน แล้วจั่วใหม่แทนเท่าจำนวนนั้น",
    en: "Pick cards to return — draw that many new ones",
  },
  "controlBar.clearSelection": { th: "ล้างที่เลือก", en: "Clear Selection" },
  "controlBar.mulliganSubmit": {
    th: (n: number) => `เปลี่ยน ${n} ใบ`,
    en: (n: number) => `Mulligan ${n} card(s)`,
  },
  "controlBar.keepHand": { th: "เก็บมือนี้", en: "Keep This Hand" },
  "controlBar.chosenWaiting": {
    th: (names: string) => `เลือกแล้ว — รอ ${names}`,
    en: (names: string) => `Chosen — waiting on ${names}`,
  },
  "controlBar.chosen": { th: "เลือกแล้ว", en: "Chosen" },
  "controlBar.theyChose": { th: (name: string) => `${name} เลือกแล้ว`, en: (name: string) => `${name} has chosen` },
  "controlBar.waitingToPick": {
    th: (name: string) => `รอ ${name} เลือกการ์ด`,
    en: (name: string) => `Waiting on ${name} to pick cards`,
  },
  "controlBar.levelUpHeading": {
    th: (name: string, level: number) => `เลเวลอัป ${name} → Lv.${level}`,
    en: (name: string, level: number) => `Level Up ${name} → Lv.${level}`,
  },
  "controlBar.levelUpHint": {
    th: (picked: number, cost: number) => `เลือกการ์ดในมือเพื่อทิ้ง ${picked}/${cost} ใบ`,
    en: (picked: number, cost: number) => `Pick cards from hand to discard ${picked}/${cost}`,
  },
  "controlBar.turnHeading": {
    th: (n: number, name: string) => `เทิร์น ${n} · ${name}`,
    en: (n: number, name: string) => `Turn ${n} · ${name}`,
  },
  "controlBar.mainPhaseHint": {
    th: () => `คลิกการ์ด/ตัวละครเพื่อใช้หรือกด Battle`,
    en: () => `Click a card or character to act, or press Battle`,
  },
  "controlBar.noActionsLeft": { th: "ใช้แอ็กชันครบแล้ว", en: "No actions left" },
  "controlBar.canCommitHint": {
    th: "คลิกการ์ดเพื่อลงคว่ำ หรือกด End เพื่อผ่าน",
    en: "Click a card to commit it, or press End to pass",
  },
  "controlBar.cannotCommitHint": {
    th: "ไม่มีการ์ดที่จ่ายไหว — กด End",
    en: "No card you can afford — press End",
  },
  "controlBar.waitOtherMainPhase": {
    th: (name: string) => `รอ ${name} จบเฟสหลักก่อน`,
    en: (name: string) => `Waiting for ${name} to finish the Main Phase`,
  },
  "controlBar.committed": { th: "ลงคว่ำแล้ว", en: "Committed" },
  "controlBar.passed": { th: "ไม่ลงการ์ด", en: "Passed" },
  "controlBar.waitingOtherSide": {
    th: (state: string) => `${state} — รออีกฝ่ายเลือก`,
    en: (state: string) => `${state} — waiting on the other side`,
  },
  "controlBar.comboOwnHint": { th: "คลิกการ์ดในมือเพื่อคอมโบ", en: "Click a card in hand to combo" },
  "controlBar.comboUnlimited": { th: " (ไม่จำกัด)", en: " (unlimited)" },
  "controlBar.comboRemaining": { th: (n: number) => ` (เหลือ ${n})`, en: (n: number) => ` (${n} left)` },
  "controlBar.switchToCombo": {
    th: (name: string) => `สลับมุมมองไป ${name} เพื่อคอมโบ`,
    en: (name: string) => `Switch view to ${name} to combo`,
  },
  "controlBar.waitingToCombo": { th: (name: string) => `รอ ${name} คอมโบ`, en: (name: string) => `Waiting on ${name} to combo` },
  "controlBar.waitingToPlay": { th: (name: string) => `รอ ${name} เล่น...`, en: (name: string) => `Waiting on ${name}...` },
  "controlBar.waitingToAnswer": {
    th: (name: string) => `รอ ${name} ตอบคำถาม...`,
    en: (name: string) => `Waiting on ${name} to answer...`,
  },
  "controlBar.cancelQuestionTitle": {
    th: "ยกเลิกการสั่งที่ค้างอยู่ แล้วกลับไปที่กระดานเดิม",
    en: "Cancel the pending question and go back to the board",
  },
  "controlBar.concedeTitle": { th: (name: string) => `${name} ยอมแพ้ทันที`, en: (name: string) => `${name} concedes immediately` },
  "controlBar.concede": { th: "ยอมแพ้", en: "Concede" },

  // --- PhaseTrack.tsx -----------------------------------------------------
  "phaseTrack.ariaLabel": { th: "ลำดับเฟสในเทิร์น", en: "Turn phase order" },
  "phaseTrack.draw": { th: "เฟสจั่ว — กดเพื่อจั่วการ์ด", en: "Draw Phase — press to draw a card" },
  "phaseTrack.main": {
    th: "เฟสหลัก — ชาร์จ เลเวลอัป สลับ Leader (อย่างละครั้ง)",
    en: "Main Phase — Charge, Level Up, Switch Leader (once each)",
  },
  "phaseTrack.battle": { th: "เฟสประลอง — ลงการ์ดคว่ำ", en: "Battle Phase — commit a card face-down" },
  "phaseTrack.judgement": {
    th: "เฟสตัดสิน — เปิดการ์ด ตัดสินผล และโจมตีต่อเนื่อง",
    en: "Judgement Phase — reveal cards, settle the result, and combo",
  },
  "phaseTrack.end": { th: "เฟสจบเทิร์น", en: "End Phase" },

  // --- MatchLog.tsx -------------------------------------------------------
  "matchLog.manualHeading": { th: "ต้องทำเอง", en: "Do This Yourself" },
  "matchLog.empty": { th: "ยังไม่มีบันทึกการต่อสู้", en: "No battle log yet" },

  // --- PlayGame.tsx -------------------------------------------------------
  "playGame.offlineSuffix": { th: " · หลุด", en: " · disconnected" },
  "playGame.viewHand": { th: (name: string) => `ดูมือ ${name}`, en: (name: string) => `View ${name}'s hand` },
  "playGame.newGame": { th: "เกมใหม่", en: "New Game" },
  "playGame.chargeLabel": { th: "ชาร์จ", en: "Charge" },
  "playGame.chargeHint": {
    th: (n: number) => `เก็บเป็นพลังงาน (เทิร์นละ ${n} ใบ)`,
    en: (n: number) => `Bank it as energy (${n} per turn)`,
  },
  "playGame.commitLabel": { th: "ลงคว่ำ", en: "Commit" },
  "playGame.commitHint": {
    th: "เข้าเฟสประลอง — เปิดพร้อมกันทั้งสองฝ่าย",
    en: "Enter the Battle Phase — both sides reveal together",
  },

  // --- ChoiceDialog.tsx ---------------------------------------------------
  "choiceDialog.cancelAllTitle": {
    th: "ยกเลิกการสั่งทั้งหมด แล้วกลับไปที่กระดานเดิม",
    en: "Cancel the whole move and go back to the board",
  },
  "choiceDialog.no": { th: "ไม่", en: "No" },
  "choiceDialog.ok": { th: "ตกลง", en: "OK" },
  "choiceDialog.decline": { th: "ไม่เอา", en: "No thanks" },

  // --- ConfirmDialog.tsx (defaults only — most calls pass their own text) --
  "confirmDialog.confirm": { th: "ยืนยัน", en: "Confirm" },
  "confirmDialog.cancel": { th: "ยกเลิก", en: "Cancel" },

  // --- DetailPanel.tsx -----------------------------------------------------
  "detailPanel.colorRed": { th: "แดง", en: "Red" },
  "detailPanel.colorGreen": { th: "เขียว", en: "Green" },
  "detailPanel.colorBlue": { th: "น้ำเงิน", en: "Blue" },
  "detailPanel.placeholder": { th: "ชี้เมาส์ที่การ์ดเพื่อดูรายละเอียด", en: "Hover a card to see its details" },
  "detailPanel.manualTag": { th: "ผู้เล่นทำเอง", en: "Do it yourself" },
  "detailPanel.noEffect": { th: "การ์ดใบนี้ไม่มีเอฟเฟค", en: "This card has no effect" },

  // --- CharacterSlot.tsx ---------------------------------------------------
  "characterSlot.view": { th: "ดู", en: "View" },
  "characterSlot.wholePileHint": { th: (n: number) => `กองการ์ดทั้งหมด (${n} ใบ)`, en: (n: number) => `Whole pile (${n} cards)` },
  "characterSlot.levelUp": { th: "เลเวลอัป", en: "Level Up" },
  "characterSlot.playableHint": { th: (n: number) => `${n} ใบที่ลงได้`, en: (n: number) => `${n} playable` },
  "characterSlot.switch": { th: "สลับ", en: "Switch" },
  "characterSlot.switchFromLeaderHint": {
    th: "เอาตัวหลังขึ้นมาเป็น Leader",
    en: "Bring a back character up as Leader",
  },
  "characterSlot.switchFromBackHint": { th: "ขึ้นมาเป็น Leader", en: "Become the Leader" },
  "characterSlot.multiActionTitle": {
    th: (name: string) => `${name} — ดู / เลเวลอัป / สลับ`,
    en: (name: string) => `${name} — View / Level Up / Switch`,
  },
  "characterSlot.viewOnlyTitle": {
    th: (name: string, n: number) => `ดูการ์ดทั้งกองของ ${name} (${n} ใบ)`,
    en: (name: string, n: number) => `View ${name}'s whole pile (${n} cards)`,
  },
  "characterSlot.levelUpMenuHead": { th: "เลเวลอัปด้วยใบไหน", en: "Level up with which card?" },
  "characterSlot.levelUpItemHint": {
    th: (id: string, level: number) => `(${id}) — ทิ้ง ${level} ใบ`,
    en: (id: string, level: number) => `(${id}) — discard ${level} card(s)`,
  },
  "characterSlot.switchMenuHead": { th: "สลับเป็นใคร", en: "Switch to whom?" },

  // --- ChatPanel.tsx -------------------------------------------------------
  "chatPanel.sameScreen": { th: "เล่นอยู่หน้าจอเดียวกัน — คุยกันได้เลย", en: "Playing on the same screen — just talk" },
  "chatPanel.empty": { th: "ยังไม่มีข้อความ", en: "No messages yet" },
  "chatPanel.placeholder": { th: "พิมพ์ข้อความ...", en: "Type a message..." },
  "chatPanel.send": { th: "ส่ง", en: "Send" },

  // --- LevelUpConfirm.tsx ---------------------------------------------------
  "levelUpConfirm.prompt": {
    th: (name: string, level: number, n: number) => `เลเวลอัป ${name} เป็น Lv.${level} โดยทิ้งการ์ด ${n} ใบ?`,
    en: (name: string, level: number, n: number) => `Level up ${name} to Lv.${level}, discarding ${n} card(s)?`,
  },

  // --- PileModal.tsx --------------------------------------------------------
  "pileModal.empty": { th: "ไม่มีการ์ด", en: "No cards" },

  // --- OwnActionSlot.tsx -----------------------------------------------------
  "ownActionSlot.committed": { th: "คว่ำไว้", en: "Committed" },

  // --- NetGame.tsx ----------------------------------------------------------
  "netGame.connecting": { th: "กำลังเชื่อมต่อกับเกม...", en: "Connecting to the game..." },

  // --- matchController.ts (fallback seat names, before the server/session
  //     has sent real ones) ----------------------------------------------
  "matchController.player": { th: (seat: number) => `ผู้เล่น ${seat}`, en: (seat: number) => `Player ${seat}` },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;
