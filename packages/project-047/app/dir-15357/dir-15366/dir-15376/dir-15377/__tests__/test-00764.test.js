const leaf = require('./test-00764.leaf');

test('test-00764', () => {
  const expected = 'test-00764';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
