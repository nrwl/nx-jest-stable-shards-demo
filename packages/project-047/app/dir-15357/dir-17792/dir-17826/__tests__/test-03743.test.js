const leaf = require('./test-03743.leaf');

test('test-03743', () => {
  const expected = 'test-03743';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
