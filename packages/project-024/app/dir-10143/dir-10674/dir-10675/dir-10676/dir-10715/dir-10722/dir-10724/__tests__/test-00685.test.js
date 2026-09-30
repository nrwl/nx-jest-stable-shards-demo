const leaf = require('./test-00685.leaf');

test('test-00685', () => {
  const expected = 'test-00685';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
