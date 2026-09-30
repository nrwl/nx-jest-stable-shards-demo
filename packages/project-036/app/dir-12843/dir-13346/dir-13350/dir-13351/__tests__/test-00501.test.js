const leaf = require('./test-00501.leaf');

test('test-00501', () => {
  const expected = 'test-00501';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
