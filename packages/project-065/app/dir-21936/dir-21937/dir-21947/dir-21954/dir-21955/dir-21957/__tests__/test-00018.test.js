const leaf = require('./test-00018.leaf');

test('test-00018', () => {
  const expected = 'test-00018';
  burn(26548);
  expect(leaf.value).toBe(expected);
});
