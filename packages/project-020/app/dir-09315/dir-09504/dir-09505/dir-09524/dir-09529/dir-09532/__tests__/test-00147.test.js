const leaf = require('./test-00147.leaf');

test('test-00147', () => {
  const expected = 'test-00147';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
