<template lang="pug">
Hero
.divider
section.how-it-works
  p.section-title How it works
  .steps-row
    .step-card
      p.step-num Step 01
      h3.step-title Play for free
      p.step-desc Episode 1 is fully free — no account, no download. Jump straight in.
    .step-card
      p.step-num Step 02
      h3.step-title Unlock the full game
      p.step-desc Own Quake? Upload your #[code pak1.pak] to unlock all 4 episodes. Verified locally — never uploaded to our servers.
    .step-card
      p.step-num Step 03
      h3.step-title Connect & compete
      p.step-desc Join community servers, play custom maps, and experience Quake in your browser.
</template>

<script lang="ts" setup>
import Hero from './Hero.vue'
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.divider {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 48px;
  border-top: $border-subtle;
}

.how-it-works {
  max-width: 900px;
  margin: 0 auto;
  padding: 64px 48px;

  @media (max-width: 600px) {
    padding: 48px 24px;
  }
}

.section-title {
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  margin-bottom: 36px;
}

.steps-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: $palette-border;
  border: 1px solid $palette-border;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.step-card {
  padding: 28px 24px;
  background: $palette-surface;
}

.step-num {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-labels;
  color: $palette-red;
  text-transform: uppercase;
  margin-bottom: $gap-3;
}

.step-title {
  font-size: $font-md;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  margin-bottom: $gap-2;
}

.step-desc {
  font-size: $font-sm;
  color: $palette-muted;
  line-height: 1.65;

  code {
    color: $palette-yellow;
    font-family: monospace;
    font-size: $font-xs;
  }
}
</style>
