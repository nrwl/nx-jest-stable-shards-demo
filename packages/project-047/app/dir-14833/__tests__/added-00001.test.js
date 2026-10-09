const leaf = require('./added-00001.leaf');

test('added-00001', () => {
  expect(leaf.value).toBe('added-00001');
});
