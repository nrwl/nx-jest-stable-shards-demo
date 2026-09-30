const leaf = require('./test-00018.leaf');

test('test-00018', () => {
  const expected = 'test-00018';
  burn(8287);
  expect(leaf.value).toBe(expected);
});
