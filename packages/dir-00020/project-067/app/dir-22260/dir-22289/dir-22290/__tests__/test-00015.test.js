const leaf = require('./test-00015.leaf');

test('test-00015', () => {
  const expected = 'test-00015';
  burn(63144);
  expect(leaf.value).toBe(expected);
});
