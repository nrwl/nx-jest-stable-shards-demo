const leaf = require('./test-00239.leaf');

test('test-00239', () => {
  const expected = 'test-00239';
  burn(2513);
  expect(leaf.value).toBe(expected);
});
