import { LogBox } from 'react-native';


LogBox.ignoreLogs(['Fetch error details']); 

LogBox.ignoreAllLogs(true);import 'react-native-gesture-handler';
import React, { useEffect, useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  Image, 
  StyleSheet, 
  Dimensions, 
  ActivityIndicator,
  Platform,
  RefreshControl,
  Alert
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// --- CONFIGURATION ---
const FLICKR_API_URL = "https://api.flickr.com/services/rest/?method=flickr.photos.getRecent&per_page=20&page=1&api_key=6f102c62f41998d151e5a1b48713cf13&format=json&nojsoncallback=1&extras=url_s";
const CACHE_KEY = 'cached_flickr_images';
const CACHE_TIMESTAMP_KEY = 'cached_flickr_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Function to build Flickr image URL using the standard pattern
const getFlickrImageURL = (photoItem) => {
  if (photoItem.url_s) {
    return photoItem.url_s;
  }
  // Fallback URL construction if url_s is not available
  return `https://farm${photoItem.farm}.staticflickr.com/${photoItem.server}/${photoItem.id}_${photoItem.secret}_q.jpg`;
};

// --- HOME SCREEN COMPONENT ---
function HomeScreen() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchImages();
  }, []);

  // Function to check if cache is still valid
  const isCacheValid = async () => {
    try {
      const timestampStr = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (!timestampStr) return false;
      
      const timestamp = parseInt(timestampStr, 10);
      const currentTime = Date.now();
      return (currentTime - timestamp) < CACHE_DURATION;
    } catch (err) {
      console.error('Error checking cache validity:', err);
      return false;
    }
  };

  const fetchImages = useCallback(async (isManualRefresh = false) => {
    // Don't start new fetch if already loading (unless it's manual refresh)
    if (loading && !isManualRefresh) return;
    
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    setError(null); // Clear any previous errors

    try {
      let currentData = [];
      let shouldFetchFromAPI = true;
      
      // 1. LOAD CACHE FIRST (only if not a manual refresh)
      if (!isManualRefresh) {
        try {
          const cacheValid = await isCacheValid();
          if (cacheValid) {
            const cachedData = await AsyncStorage.getItem(CACHE_KEY);
            if (cachedData) {
              currentData = JSON.parse(cachedData);
              setImages(currentData);
              console.log('Loaded from valid cache');
              
              // If cache is still valid and we're not forcing refresh, skip API call
              shouldFetchFromAPI = false;
            }
          }
        } catch (cacheError) {
          console.log('Cache read error:', cacheError);
          // Continue to API fetch if cache fails
        }
      }

      // 2. FETCH FROM API (if needed)
      if (shouldFetchFromAPI) {
        const response = await axios.get(FLICKR_API_URL);
        
        // Check if API response structure is valid
        if (!response.data || !response.data.photos || !response.data.photos.photo) {
          throw new Error('Invalid API response structure');
        }
        
        const newPhotos = response.data.photos.photo;
        
        if (!Array.isArray(newPhotos) || newPhotos.length === 0) {
          throw new Error('No photos found in API response');
        }
        
        // Map to a cleaner format with proper URL construction
        const formattedNewData = newPhotos.map(item => ({
          id: item.id,
          url: getFlickrImageURL(item),
          title: item.title || 'Untitled',
          farm: item.farm,
          server: item.server,
          secret: item.secret
        }));

        // 3. UPDATE STATE AND CACHE
        // Always update when data is different or on manual refresh
        const currentDataStr = JSON.stringify(currentData);
        const newDataStr = JSON.stringify(formattedNewData);
        
        if (currentDataStr !== newDataStr || isManualRefresh) {
          console.log('Updating images and cache...');
          setImages(formattedNewData);
          
          // Save to cache with timestamp
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(formattedNewData));
          await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } else {
          console.log('Data unchanged, cache remains valid');
        }
      }
      
    } catch (error) {
      console.error('Fetch error details:', error);
      
      // Enhanced error handling
      let errorMessage = 'Failed to load images';
      
      if (error.response) {
        // Server responded with error status
        errorMessage = `Server error: ${error.response.status}`;
        console.error('Server Error Status:', error.response.status);
      } else if (error.request) {
        // Request was made but no response received
        if (images.length === 0) {
          errorMessage = 'Network error. Please check your connection.';
        } else {
          errorMessage = 'Network error. Showing cached images.';
        }
        console.log('Network Error - Possibly offline');
      } else {
        // Something else went wrong
        errorMessage = `Error: ${error.message}`;
        console.error('Request Setup Error:', error.message);
      }
      
      setError(errorMessage);
      
      // If we have no images and got an error, show alert
      if (images.length === 0 && errorMessage) {
        Alert.alert(
          'Unable to Load Images',
          errorMessage,
          [{ text: 'OK', onPress: () => {} }]
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loading]);

  // Pull to refresh handler
  const onRefresh = useCallback(() => {
    fetchImages(true);
  }, [fetchImages]);

  const renderItem = ({ item }) => (
    <View style={styles.imageContainer}>
      <Image 
        source={{ uri: item.url }} 
        style={styles.image} 
        resizeMode="cover"
        onError={(error) => console.log(`Failed to load image: ${item.id}`, error.nativeEvent.error)}
      />
      {item.title && item.title !== 'Untitled' && (
        <Text style={styles.imageTitle} numberOfLines={2}>{item.title}</Text>
      )}
    </View>
  );

  const renderFooter = () => {
    if (!loading) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#0000ff" />
        <Text style={styles.loadingText}>Loading more images...</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Error message display */}
      {error && images.length === 0 && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText} onPress={() => fetchImages()}>
            Tap to retry
          </Text>
        </View>
      )}

      {/* Loading indicator for initial load */}
      {loading && images.length === 0 && !error ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>Loading images...</Text>
        </View>
      ) : (
        <FlatList
          data={images}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !loading && error ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No images available</Text>
                <Text style={styles.retryText} onPress={() => fetchImages()}>
                  Tap to retry
                </Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#0000ff']}
              tintColor="#0000ff"
            />
          }
        />
      )}
    </View>
  );
}

// --- NAVIGATION SETUP ---
const Drawer = createDrawerNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Drawer.Navigator 
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#f8f8f8',
          },
          headerTintColor: '#333',
        }}
      >
        <Drawer.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ 
            title: 'Recent Flickr Uploads',
            drawerLabel: 'Home'
          }} 
        />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}

// --- STYLES ---
const { width } = Dimensions.get('window');
const IMAGE_SIZE = (width / 2) - 15;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  list: {
    padding: 5,
    minHeight: '100%',
  },
  imageContainer: {
    flex: 1,
    margin: 5,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
  },
  image: {
    width: '100%',
    height: IMAGE_SIZE,
  },
  imageTitle: {
    padding: 8,
    fontSize: 12,
    color: '#333',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 20,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#ff3333',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
  },
  retryText: {
    fontSize: 16,
    color: '#0000ff',
    textDecorationLine: 'underline',
  },
});