<template lang="pug">
.id1-assets
  .section-label Game assets
  .asset-grid
    //- pak0 card
    .asset-card
      .asset-head
        span.asset-name pak0.pak
        .asset-head-right
          span.asset-badge(:class="packZero ? 'badge-ok' : 'badge-missing'")
            | {{ packZero ? '✓ Loaded' : 'Not loaded' }}
          button.remove-btn(v-if="packZero" @click="removePak(packZero.assetId)" title="Remove pak0.pak")
            font-awesome-icon(icon="fa-solid fa-xmark")
      .asset-desc Shareware assets — Episode 1 maps, textures, sounds and models. Included with the free client.
      .asset-meta(v-if="packZero") Files:&nbsp;
        span {{ packZero.fileCount }}
        span.verdict-ok(v-if="pakZeroVerdict === 'official'") &nbsp;·&nbsp;✓ official {{ officialLabel('pak0.pak') }}
      .asset-warn(v-if="pakZeroVerdict === 'nonstandard'")
        | This file doesn't match the official {{ officialLabel('pak0.pak') }} pak0.pak. In multiplayer, players whose pak files differ see broken geometry — falling into stairs, walking through walls.

    //- pak1 card
    .asset-card
      .asset-head
        span.asset-name pak1.pak
        .asset-head-right
          span.asset-badge(:class="packOne ? 'badge-ok' : 'badge-missing'")
            | {{ packOne ? '✓ Loaded' : 'Not loaded' }}
          button.remove-btn(v-if="packOne" @click="removePak(packOne.assetId)" title="Remove pak1.pak")
            font-awesome-icon(icon="fa-solid fa-xmark")
      .asset-desc Full game assets — Episodes 2–4 maps, textures, sounds and models. Requires a purchased copy of Quake.
      .asset-meta(v-if="packOne") Files:&nbsp;
        span {{ packOne.fileCount }}
        span.verdict-ok(v-if="pakOneVerdict === 'official'") &nbsp;·&nbsp;✓ official {{ officialLabel('pak1.pak') }}
      .asset-warn(v-if="pakOneVerdict === 'nonstandard'")
        | This file doesn't match the official {{ officialLabel('pak1.pak') }} pak1.pak. In multiplayer, players whose pak files differ see broken geometry — falling into stairs, walking through walls.
      .asset-action(v-if="!packOne")
        button.btn-ghost-sm(@click="gameStore.openPak1Modal()") Upload pak1.pak
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue'
import { useGameStore } from '../../../../stores/game'
import { pakVerdict, OFFICIAL_ID1_PAKS } from '../../../../helpers/officialPaks'

const gameStore = useGameStore()

onMounted(() => { gameStore.ensurePakChecksums() })

const assetMetas = computed(() =>
  gameStore.assetMetas.filter(am =>
    am.game === 'id1' &&
    (am.fileName.toLowerCase() === 'pak0.pak' || am.fileName.toLowerCase() === 'pak1.pak')
  )
)
const packZero = computed(() => assetMetas.value.find(am => am.fileName.toLowerCase() === 'pak0.pak'))
const packOne  = computed(() => assetMetas.value.find(am => am.fileName.toLowerCase() === 'pak1.pak'))

const pakZeroVerdict = computed(() => packZero.value ? pakVerdict('pak0.pak', packZero.value.sha256) : 'unknown')
const pakOneVerdict  = computed(() => packOne.value ? pakVerdict('pak1.pak', packOne.value.sha256) : 'unknown')
const officialLabel = (fileName: string) => OFFICIAL_ID1_PAKS[fileName].label

const removePak = async (assetId: number) => {
  if (!confirm('Remove this pak file?')) return
  await gameStore.removeAsset(assetId.toString())
}
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.id1-assets { margin-bottom: 40px; }

.section-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
  margin-bottom: 14px;
}

.asset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: $palette-border;
  border: $border-subtle;
  @media (max-width: 600px) { grid-template-columns: 1fr; }
}

.asset-card {
  background: $palette-surface;
  padding: 20px 24px;
}

.asset-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.asset-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: $palette-muted;
  font-size: $font-xs;
  padding: 2px 4px;
  line-height: 1;
  transition: $transition-color;
  &:hover { color: $palette-red; }
}

.asset-name {
  font-size: 14px;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  font-family: 'JetBrains Mono', monospace;
}

.asset-badge {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  padding: 3px 10px;
  &.badge-ok      { background: rgba(74, 158, 74, 0.15); color: #4a9e4a; }
  &.badge-missing { background: rgba(102, 102, 102, 0.15); color: $palette-muted; }
}

.asset-desc {
  font-size: $font-sm;
  color: $palette-muted;
  line-height: 1.6;
  margin-bottom: 12px;
}

.asset-meta {
  font-size: $font-xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
  span { color: $palette-text; }
  span.verdict-ok { color: #4a9e4a; }
}

.asset-warn {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: $font-xs;
  line-height: 1.5;
  color: $palette-yellow;
  background: rgba(240, 184, 0, 0.08);
  border-left: 2px solid $palette-yellow;
}

.asset-action { margin-top: 14px; }

.hidden-pak-input { display: none; }

.btn-ghost-sm {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 7px 16px;
  background: transparent;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;
  &:hover:not(:disabled) { color: $palette-bright; border-color: $palette-text; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
