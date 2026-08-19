<template lang="pug">
.main
  .container.grid-lg
    Header
    .app-content
      router-view
    Footer
</template>
<script lang="ts" setup>
import QuakeText from '../QuakeText.vue'
import Footer from './Footer.vue'
import Profile from './Profile.vue';
import Header from './Header.vue'

</script>