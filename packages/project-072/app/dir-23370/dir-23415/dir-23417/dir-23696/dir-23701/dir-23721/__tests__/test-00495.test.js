const leaf = require('./test-00495.leaf');

test('test-00495', () => {
  const expected = 'test-00495';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
