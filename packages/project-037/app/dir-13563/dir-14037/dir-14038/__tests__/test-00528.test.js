const leaf = require('./test-00528.leaf');

test('test-00528', () => {
  const expected = 'test-00528';
  burn(7935);
  expect(leaf.value).toBe(expected);
});
