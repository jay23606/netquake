<template>
  <button
    :class="['btn', `btn--${variant}`, `btn--${size}`, { 'btn--disabled': disabled }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup>
defineProps({
  variant: {
    type: String,
    default: 'red',
    validator: (v) => ['red', 'ghost'].includes(v),
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['click'])
</script>

<style lang="scss" scoped>
// ── Design tokens (mirror your CSS vars) ──────────────────────────────────────
$color-red:     #e03020;
$color-red-hover: #f03828;
$color-surface: #242424;
$color-border:  #333333;
$color-muted:   #666666;
$color-bright:  #ffffff;

// ── Base ──────────────────────────────────────────────────────────────────────
.btn {
  // Tailwind utility classes handle layout & reset
  @apply inline-flex items-center justify-center
         font-bold uppercase tracking-wide
         border-0 cursor-pointer
         transition-all duration-150
         select-none whitespace-nowrap;

  font-family: 'Albert Sans', sans-serif;

  // Disabled state
  &--disabled {
    @apply opacity-40 cursor-not-allowed pointer-events-none;
  }

  // ── Sizes ──────────────────────────────────────────────────────────────────
  &--sm {
    @apply text-xs px-4 py-2;
    letter-spacing: 0.06em;
  }

  &--md {
    @apply text-sm px-5 py-2;
    letter-spacing: 0.06em;
  }

  &--lg {
    @apply text-base px-9 py-3.5;
    letter-spacing: 0.06em;
  }

  // ── Variants ───────────────────────────────────────────────────────────────
  &--red {
    background-color: $color-red;
    color: $color-bright;

    &:hover:not(.btn--disabled) {
      background-color: $color-red-hover;
    }
  }

  &--ghost {
    background-color: transparent;
    border: 1px solid $color-border;
    color: $color-muted;

    &:hover:not(.btn--disabled) {
      border-color: $color-bright;
      color: $color-bright;
    }
  }
}
</style>