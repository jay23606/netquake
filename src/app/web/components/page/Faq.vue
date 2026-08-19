<template lang="pug">
.page
  .page-header
    h1.page-title FAQ
    p.page-sub Frequently asked questions about NetQuake and Quake
  .faq-list
    .faq-item(v-for="(qa, idx) in qas" :key="idx" :class="{ 'is-open': openIdx === idx }")
      button.faq-question(@click="toggle(idx)")
        span {{ qa.question }}
        font-awesome-icon.faq-chevron(icon="fa-solid fa-chevron-right")
      .faq-answer-wrap
        .faq-answer(v-html="qa.answer")
</template>

<script setup lang="ts">
import { ref } from 'vue'

type QA = { question: string; answer: string }

const openIdx = ref<number | null>(null)
const toggle = (idx: number) => { openIdx.value = openIdx.value === idx ? null : idx }

const qas: QA[] = [{
  question: 'Why are some features of the site disabled?',
  answer: `<p>Many features of this site are disabled because they require the pak1.pak file, which is only available with a purchased copy of Quake. Only features available in the shareware version are enabled by default.`
}, {
  question: 'What is shareware?',
  answer: `<p>Shareware is an old term referring to a portion of a game distributed for free as a demo. This usually included only a few levels — in the case of Quake, the first episode. To play the full game, you needed to purchase a copy.`
}, {
  question: 'What is a pak file?',
  answer: `<p>A pak file is an archive containing game assets like maps, models, sounds, and more. The base game shipped with two pak files — pak0.pak and pak1.pak.
   <p>pak0.pak shipped with the shareware version of Quake and was freely distributable.
   <p>pak1.pak was only included with the purchased version, which is why this site cannot provide it. It is also required to play any modified games or custom maps.`
}, {
  question: 'Where can I buy Quake?',
  answer: `<p>Quake is available on <a href="https://www.gog.com/en/game/quake_the_offering" target="_blank">GOG</a> and <a href="https://store.steampowered.com/agecheck/app/2310/" target="_blank">Steam</a> for around $10, and regularly goes on sale for under $5. After purchasing, locate pak1.pak in your Quake installation and upload it in the <a href="/setup?tab=packages">Setup → Packages</a> section.`
}, {
  question: 'Where is my pak1.pak file?',
  answer: `<p>pak1.pak is located in the <pre>id1</pre> directory of your Quake installation. The exact path depends on where you purchased it, your operating system, and whether you customized the install location.
  <br><br>Steam on Windows: <pre>C:\\Program Files (x86)\\Steam\\steamapps\\common\\Quake\\id1</pre>
  <br>GOG on Windows: <pre>C:\\GOG Games\\Quake\\id1</pre>`
}, {
  question: 'How do I assign a key to the rocket launcher?',
  answer: `<p>Quake's menu has limited configuration options and does not support binding weapons to keys directly. Instead, you can use the console to bind a key with the following command:
      <p><pre>bind &lt;key&gt; "impulse #"</pre>
      <p>where # is the weapon number:
        <ul>
          <li>1 - Axe</li>
          <li>2 - Shotgun</li>
          <li>3 - Super Shotgun</li>
          <li>4 - Nailgun</li>
          <li>5 - Super Nailgun</li>
          <li>6 - Grenade Launcher</li>
          <li>7 - Rocket Launcher</li>
          <li>8 - Lightning Gun</li>
        </ul>
      <p>You can also add these binds directly to your <pre>autoexec.cfg</pre> in the <a href="/setup">setup</a> section. They will be applied every time the game starts.`
}, {
  question: 'How do I play a custom map I downloaded?',
  answer: `<p>NetQuake supports custom map packs in zip format. To add one:
    <ol>
      <li>Go to <a href="/setup?tab=packages">Setup → Packages</a> and create a new package.</li>
      <li>Drop your zip file (or individual BSP map files) onto the package to import them.</li>
      <li>Once imported, open <a href="/singleplayer">Singleplayer</a> and find your package in the <strong>My Packages</strong> section.</li>
      <li>Select a map from the dropdown and hit Play.</li>
    </ol>
    <p>Custom maps require pak1.pak from a purchased copy of Quake. If you haven't loaded it yet, see the setup section for instructions.`
}, {
  question: 'What are these files — Autoexec.cfg and Config.cfg?',
  answer: `<p>Both files contain configuration commands that are executed when the game starts.
    <p><pre>config.cfg</pre> is where the game stores your settings — key bindings, mouse sensitivity, video options, etc. You can edit it manually, but some values may be overwritten by the game.
    <p><pre>autoexec.cfg</pre> is an optional file for your own custom commands that run on every startup. The game engine will never overwrite it.
    <p>You can edit both files in the <a href="/setup">setup</a> section.`
}, {
  question: 'How do multiplayer rooms work?',
  answer: `<p>Multiplayer in NetQuake uses rooms — shared sessions that players join before starting a game together.
    <ul>
      <li>Any player can <strong>Create a room</strong> from the Multiplayer page. This makes you the host.</li>
      <li>Share the room link or code with friends so they can join.</li>
      <li>As the host, you choose the map and game settings, then start the match when everyone is ready.</li>
      <li>Guests can see the room state and chat, but only the host can change settings or launch the game.</li>
    </ul>
    <p>All players need pak1.pak from a purchased copy of Quake to play multiplayer.`
}, {
  question: 'My mouse does not look up or down — how do I fix this?',
  answer: `<p>By default, Quake uses keyboard-style look where moving the mouse only turns left and right. To enable free mouse look, open the console and type:
    <p><pre>+mlook</pre>
    <p>To make this permanent, add <pre>+mlook</pre> to your <pre>autoexec.cfg</pre> in the <a href="/setup">Setup</a> section. The recommended autoexec (applied automatically on first run) already includes this.`
}, {
  question: 'The game is running slowly — how can I improve performance?',
  answer: `<p>A few things to try:
    <ul>
      <li><strong>Enable hardware acceleration</strong> in your browser. This is usually on by default but can be disabled in browser settings.</li>
      <li><strong>Lower the view size</strong> using <pre>-</pre> on your keyboard, or set <pre>viewsize 80</pre> in the console. A smaller viewport renders fewer pixels.</li>
      <li><strong>Use a Chromium-based browser</strong> (Chrome, Edge, Brave). WebGL performance varies significantly between browsers.</li>
      <li><strong>Close other tabs and applications</strong> to free up memory and GPU resources.</li>
    </ul>`
}, {
  question: 'Can I play on mobile?',
  answer: `<p>NetQuake runs in mobile browsers but is designed primarily for desktop play with a keyboard and mouse. Touch controls are limited and the experience may not be ideal on smaller screens.
    <p>For the best experience, use a desktop or laptop with a physical keyboard and mouse.`
}, {
  question: 'What file formats are supported for custom packages?',
  answer: `<p>You can import custom content in several ways from <a href="/setup?tab=packages">Setup → Packages</a>:
    <ul>
      <li><strong>ZIP file</strong> — Drop a zip onto the import area. NetQuake will extract it and create a new package automatically. Most map releases distributed online come as zips.</li>
      <li><strong>PAK file</strong> — A Quake archive containing multiple assets. Drop it directly or include it inside a zip.</li>
      <li><strong>BSP file</strong> — A compiled map file. You can drop individual BSP files directly onto an existing package row to add them.</li>
      <li><strong>Loose files</strong> — WAV, MDL, SPR, and other asset types can be added individually to a package.</li>
    </ul>`
}, {
  question: 'Why did my uploaded files disappear?',
  answer: `<p>NetQuake stores all uploaded files in your browser's IndexedDB storage. This data can be cleared in a few situations:
    <ul>
      <li><strong>Private / Incognito mode</strong> — Browsers discard all local storage when an incognito session ends. Always use a normal browser window for uploads you want to keep.</li>
      <li><strong>Clearing browser data</strong> — "Clear browsing data" or "Clear site data" in your browser settings will remove uploaded files.</li>
      <li><strong>Browser storage limits</strong> — If your browser runs low on disk space it may evict site data automatically.</li>
    </ul>
    <p>To avoid losing your files, keep a copy of your pak files and any custom map zips on your computer so you can re-upload them if needed.`
}]
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 48px;
  @media (max-width: 768px) { padding: 32px 24px; }
  @media (max-width: 480px) { padding: 24px 16px; }
}

.page-header { margin-bottom: 40px; }

.page-title {
  font-size: 28px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.02em;
}

.page-sub {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;
}

.faq-list {
  display: flex;
  flex-direction: column;
  max-width: 720px;
}

.faq-item {
  border: $border-subtle;
  border-top: none;
  &:first-child { border-top: $border-subtle; }
}

.faq-question {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: $palette-surface;
  border: none;
  color: $palette-text;
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: lighten($palette-surface, 4%);
    color: $palette-bright;
  }

  .is-open & {
    color: $palette-bright;
    background: lighten($palette-surface, 4%);
    box-shadow: inset 3px 0 0 $palette-red;
  }
}

.faq-chevron {
  flex-shrink: 0;
  font-size: 10px;
  color: $palette-muted;
  transition: transform 0.2s;
  .is-open & { transform: rotate(90deg); }
}

.faq-answer-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease;
  .is-open & { grid-template-rows: 1fr; }
}

.faq-answer {
  overflow: hidden;
  font-size: $font-sm;
  color: $palette-text;
  line-height: 1.7;
  border-top: none;

  .is-open & {
    padding: 16px;
    border-top: $border-subtle;
  }

  :deep(p) { margin: 0 0 10px; &:last-child { margin-bottom: 0; } }
  :deep(pre) {
    display: inline;
    font-family: 'JetBrains Mono', monospace;
    font-size: $font-xs;
    background: $palette-body;
    border: $border-subtle;
    padding: 2px 6px;
    color: $palette-yellow;
  }
  :deep(ul), :deep(ol) { margin: 8px 0 8px 20px; padding: 0; }
  :deep(li) { margin-bottom: 4px; }
  :deep(a) { color: $palette-yellow; text-decoration: none; &:hover { text-decoration: underline; } }
}
</style>
