export default {
  '*.vue': ['eslint --fix', 'prettier --write', 'stylelint --fix'],
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write', () => 'vue-tsc -b --noEmit'],
  '*.{js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{css,scss}': ['stylelint --fix', 'prettier --write'],
  '*.{json,md,yaml,yml}': ['prettier --write'],
};
