// Settings from Amazon's "Media Player Setup" page: the W3C media package needs
// the automatic JSX runtime, otherwise "Property 'React' doesn't exist".
module.exports = {
  presets: [['module:metro-react-native-babel-preset', {useTransformReactJSXExperimental: true}]],
  plugins: [['@babel/plugin-transform-react-jsx', {runtime: 'automatic'}]],
};
