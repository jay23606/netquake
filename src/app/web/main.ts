import {createApp} from 'vue'
import { createPinia } from 'pinia'
import App from './components/App.vue'
import router from './router'
import tippy from "vue-tippy";
import Toast, { PluginOptions } from "vue-toastification";
import 'tippy.js/dist/tippy.css'
import "vue-toastification/dist/index.css";
import './scss/style.scss'
import { FontAwesomeIcon } from './icons'
import { installGlobalErrorHandlers } from '../../shared/errorReporting'

installGlobalErrorHandlers()

const pinia = createPinia()
const app = createApp(App)
  

app.component('font-awesome-icon', FontAwesomeIcon)
app.use(Toast, {
  transition: "Vue-Toastification__fade",
  maxToasts: 4,
  timeout: 5000,
  newestOnTop: true
});

app.use(pinia)
app.use(router)
app.use(tippy)
app.mount('#app')

/*
Server logic
if /

*/