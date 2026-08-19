/* eslint-env node */
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:vue/vue3-recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'eslint-plugin-vue'],
  root: true,
  overrides: [
    {
      files: ["*.ts"],
      rules: {
        "no-var": "off",
        "vue/script-setup-uses-vars": "on"
      }
    }
  ]
};