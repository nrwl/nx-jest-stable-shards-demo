const leaf = require('./test-00831.leaf');

test('test-00831', () => {
  const expected = 'test-00831';
  burn(2476);
  expect(leaf.value).toBe(expected);
});
