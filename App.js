import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  Image, 
  StyleSheet, 
  Dimensions, 
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Keyboard,
  LogBox
} from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';

// --- SILENCE LOGS ---
LogBox.ignoreAllLogs(true);

// --- CONFIGURATION ---
const API_KEY = process.env.FLICKR_API_KEY || '6f102c62f41998d151e5a1b48713cf13'; 
const BASE_URL = 'https://api.flickr.com/services/rest/';
const CACHE_KEY = 'cached_flickr_home_data';
const CACHE_EXPIRY_KEY = 'cached_flickr_data_expiry';
const CACHE_DURATION = 5 * 60 * 1000; 

// --- SNACKBAR COMPONENT (Simplified) ---
const RetrySnackbar = ({ visible, onRetry, message }) => {
  if (!visible) return null;
  
  return (
    <View style={styles.snackbarContainer}>
      <Text style={styles.snackbarText}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>RETRY</Text>
      </TouchableOpacity>
    </View>
  );
};

// --- HOME SCREEN COMPONENT ---
function HomeScreen() {
  const navigation = useNavigation();
  
  // State
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Refs
  const searchInputRef = useRef(null);
  const isMounted = useRef(true);
  const fetchTimeout = useRef(null);
  const abortController = useRef(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
      if (abortController.current) abortController.current.abort();
    };
  }, []);

  const handleSearchSubmit = useCallback(() => {
    if (searchText.trim().length > 0) {
      Keyboard.dismiss();
      fetchImages(1, searchText.trim());
    }
  }, [searchText]);

  const handleIconPress = () => {
    if (searchText.trim().length > 0) {
      handleSearchSubmit();
    } else {
      searchInputRef.current?.focus();
    }
  };

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.searchHeader}>
          <TouchableOpacity onPress={handleIconPress} style={{ padding: 5 }}>
            <Ionicons name="search" size={20} color="#666" />
          </TouchableOpacity>
          
          <TextInput
            ref={searchInputRef}
            placeholder="Search Flickr..."
            placeholderTextColor="#999"
            style={styles.searchInput}
            value={searchText}
            onChangeText={handleSearchTextChange}
            returnKeyType="search"
            onSubmitEditing={handleSearchSubmit}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {searchText.length > 0 && (
             <TouchableOpacity onPress={handleSearchSubmit} style={{ paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{color: '#007AFF', fontWeight: 'bold'}}>Search</Text>
             </TouchableOpacity>
          )}
        </View>
      ),
      headerStyle: { backgroundColor: '#fff', elevation: 0, shadowOpacity: 0 },
      headerTitleContainerStyle: { width: '100%', left: 0 },
      headerTitleAlign: 'left', 
      headerLeftContainerStyle: { paddingLeft: 10 },
    });
  }, [navigation, searchText, handleSearchSubmit]);

  useEffect(() => {
    if (isMounted.current) loadInitialData();
  }, []);

  const handleSearchTextChange = useCallback((text) => {
    setSearchText(text);
    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    if (text.length >= 2) { 
      fetchTimeout.current = setTimeout(() => {
        fetchImages(1, text.trim());
      }, 800);
    } else if (text.length === 0) {
      clearSearch();
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setIsSearching(false);
    setPage(1);
    fetchImages(1, '');
    if (searchInputRef.current) searchInputRef.current.blur();
  }, []);

  const loadInitialData = async () => {
    try {
      const [cachedData, expiryTime] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(CACHE_EXPIRY_KEY)
      ]);
      const now = Date.now();
      const isCacheValid = expiryTime && (now - parseInt(expiryTime, 10)) < CACHE_DURATION;
      if (cachedData && isCacheValid) setImages(JSON.parse(cachedData));
      fetchImages(1, '');
    } catch (error) {
      fetchImages(1, '');
    }
  };

  const fetchImages = async (pageNumber = 1, query = '') => {
    if (!isMounted.current) return;
    if (abortController.current) abortController.current.abort();
    abortController.current = new AbortController();

    const isFirstPage = pageNumber === 1;
    if (isFirstPage) {
      setLoading(true);
      setError(null);
      setHasMore(true);
      // FIX: Clear images so if it fails, the screen is empty and Retry bar shows
      setImages([]); 
    } else {
      setLoadingMore(true);
    }

    try {
      const method = query ? 'flickr.photos.search' : 'flickr.photos.getRecent';
      const params = {
        method: method, per_page: 20, page: pageNumber,
        api_key: API_KEY, format: 'json', nojsoncallback: 1,
        extras: 'url_s, url_m, url_l', text: query, safe_search: 1
      };

      const response = await axios.get(BASE_URL, { 
        params, timeout: 10000, signal: abortController.current.signal 
      });

      if (response.data.stat !== 'ok') throw new Error(response.data.message || 'API Error');

      const newPhotos = response.data.photos.photo
        .filter(item => item.url_s)
        .map(item => ({
          id: item.id, url: item.url_s, title: item.title || 'Untitled', secret: item.secret
        }));

      const totalPages = response.data.photos.pages;
      setHasMore(pageNumber < totalPages);

      if (isFirstPage) {
        setImages(newPhotos);
        if (!query) {
          AsyncStorage.multiSet([
            [CACHE_KEY, JSON.stringify(newPhotos)],
            [CACHE_EXPIRY_KEY, Date.now().toString()]
          ]);
        }
      } else {
        setImages(prev => {
          const existingIds = new Set(prev.map(img => img.id));
          const uniqueNewPhotos = newPhotos.filter(img => !existingIds.has(img.id));
          return [...prev, ...uniqueNewPhotos];
        });
      }
      setPage(pageNumber);
      setIsSearching(!!query);

    } catch (err) {
      if (axios.isCancel(err)) return;
      if (isMounted.current) {
        Keyboard.dismiss(); 
        setError('Network failure.');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  };

  const handleLoadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMore && !error) {
      fetchImages(page + 1, searchText);
    }
  }, [loading, loadingMore, hasMore, page, searchText, error]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchImages(1, searchText);
  }, [searchText]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity style={styles.imageContainer} activeOpacity={0.8} onPress={() => {}}>
      <Image source={{ uri: item.url }} style={styles.image} resizeMode="cover" />
    </TouchableOpacity>
  ), []);

  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return <View style={styles.footerContainer}><ActivityIndicator size="small" color="#0000ff" /></View>;
  }, [loadingMore]);

  const renderEmptyState = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="images-outline" size={64} color="#ccc" />
        <Text style={styles.emptyText}>
          {searchText ? `No results for "${searchText}"` : 'No images found'}
        </Text>
      </View>
    );
  }, [loading, searchText]);

  return (
    <SafeAreaView style={styles.container}>
      {loading && images.length === 0 ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#0000ff" /></View>
      ) : (
        <FlatList
          data={images}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.id}-${item.secret}`}
          numColumns={2}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmptyState}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          initialNumToRender={10}
          windowSize={5}
        />
      )}
      <RetrySnackbar 
        visible={!!error && images.length === 0} 
        message={error || "Network failure."} 
        onRetry={() => fetchImages(page, searchText)} 
      />
    </SafeAreaView>
  );
}

const Drawer = createDrawerNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Drawer.Navigator 
        initialRouteName="Home"
        screenOptions={{
          drawerStyle: { backgroundColor: '#fff', width: 250 },
          drawerActiveTintColor: '#0000ff',
        }}
      >
        <Drawer.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{
            title: 'Home', 
            headerStyle: { backgroundColor: '#fff', elevation: 0, shadowOpacity: 0 },
            headerTintColor: '#000',
          }} 
        />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}

const { width, height } = Dimensions.get('window');
const IMAGE_SIZE = (width / 2) - 15;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 5, flexGrow: 1 },
  imageContainer: {
    flex: 1, margin: 5, height: IMAGE_SIZE, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f5f5f5',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2,
  },
  image: { width: '100%', height: '100%' },
  
  searchHeader: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0',
    borderRadius: 25, paddingHorizontal: 15, paddingVertical: 8, marginRight: 15,
  },
  searchInput: { 
    flex: 1, fontSize: 16, color: '#333', padding: 0, margin: 0, height: '100%', marginLeft: 8 
  },
  
  // FIXED SNACKBAR STYLES
  snackbarContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#323232',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 20, 
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    zIndex: 9999, elevation: 10
  },
  snackbarText: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  retryButton: { marginLeft: 16, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: '#BB86FC', fontWeight: 'bold', fontSize: 14 },
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: height * 0.2 },
  emptyText: { fontSize: 16, color: '#666', marginTop: 12, textAlign: 'center' },
  footerContainer: { paddingVertical: 20, alignItems: 'center' },
});