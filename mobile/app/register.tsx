import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@dsa-portal/ui-core';
import { Body, Button, Card, ErrorText, Field, H1 } from '../src/components/ui';
import { useTheme } from '../src/theme';

export default function Register() {
  const { status, register, busy, error } = useAuth();
  const { space } = useTheme();
  const [f, setF] = useState({ username: '', email: '', password: '' });
  if (status === 'authenticated') return <Redirect href="/" />;
  const submit = () => void register(f.username.trim(), f.email.trim(), f.password);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.xl,
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <H1>Create an account</H1>
          <Field
            label="Username"
            value={f.username}
            onChangeText={(username) => setF({ ...f, username })}
            autoCapitalize="none"
            autoComplete="username"
          />
          <Field
            label="Email"
            value={f.email}
            onChangeText={(email) => setF({ ...f, email })}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={f.password}
            onChangeText={(password) => setF({ ...f, password })}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={submit}
          />
          <Body muted>
            8–72 characters, with a letter and a digit, not containing your username or email.
          </Body>
          {error && <ErrorText>{error}</ErrorText>}
          <Button title="Create account" primary busy={busy} onPress={submit} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
