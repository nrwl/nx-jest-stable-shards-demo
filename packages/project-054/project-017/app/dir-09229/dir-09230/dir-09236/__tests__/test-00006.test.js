const leaf = require('./test-00006.leaf');

test('test-00006', () => {
  const expected = 'test-00006';
  burn(47520);
  expect(leaf.value).toBe(expected);
});
