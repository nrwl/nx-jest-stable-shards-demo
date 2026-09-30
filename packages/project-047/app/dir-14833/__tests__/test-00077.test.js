const leaf = require('./test-00077.leaf');

test('test-00077', () => {
  const expected = 'test-00077';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
