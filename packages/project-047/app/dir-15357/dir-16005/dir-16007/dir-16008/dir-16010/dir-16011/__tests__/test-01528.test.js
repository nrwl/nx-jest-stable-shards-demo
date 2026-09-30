const leaf = require('./test-01528.leaf');

test('test-01528', () => {
  const expected = 'test-01528';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
